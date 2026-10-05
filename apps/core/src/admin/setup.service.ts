import { ConflictException, ForbiddenException, Inject, Injectable, Logger, type OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Redis } from 'ioredis';
import QRCode from 'qrcode';
import { CONFIG, type AppConfig } from '../config/config.js';
import { REDIS } from '../infra/redis.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { hashPassword } from '../common/password.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../common/totp.js';
import { AdminAuthService } from './auth.service.js';

const SETUP_TOKEN_KEY = 'admin:setup:token';
const PENDING_PREFIX = 'admin:setup:pending:';
const PENDING_TTL_S = 15 * 60;
/** settings.key that records that bootstrap happened; it never flips back, even if every account is disabled. */
export const BOOTSTRAP_SETTING = 'admin.bootstrappedAt';

interface Pending {
  username: string;
  passwordHash: string;
  totpSecret: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * First-run setup: when no admin login exists (no ADMIN_PASSWORD in .env and no row in admin_accounts) the UI shows
 * a setup page. It is protected by a one-time setup token the operator puts into .env (SETUP_TOKEN), so a stranger
 * who reaches a fresh deployment first cannot claim it.
 * Flow: start (token + username + password → TOTP secret + QR) → complete (code from the app → account + session).
 */
@Injectable()
export class AdminSetupService implements OnModuleInit {
  private readonly log = new Logger(AdminSetupService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AdminAuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.needed())) return;
    if (!this.cfg.SETUP_TOKEN) {
      this.log.error(`\n${'='.repeat(72)}\n  NO ADMIN LOGIN CONFIGURED and SETUP_TOKEN is not set.\n  Add to .env:  SETUP_TOKEN=<any 8+ characters>   then restart core and open the admin UI.\n${'='.repeat(72)}`);
      return;
    }
    await this.redis.set(SETUP_TOKEN_KEY, this.cfg.SETUP_TOKEN);
    this.log.warn('no admin login configured yet: open the admin UI and finish setup with SETUP_TOKEN from .env');
  }

  /**
   * True only before the first bootstrap: no env login credential, no account row and no bootstrap marker.
   * Disabling every account later does NOT reopen setup; recovery is an explicit operator action
   * (delete the `admin.bootstrappedAt` row in `settings`, set SETUP_TOKEN in .env, restart Core).
   */
  async needed(): Promise<boolean> {
    if (this.cfg.adminCredentials.some((c) => c.totpSecret)) return false;
    if (await this.prisma.setting.findUnique({ where: { key: BOOTSTRAP_SETTING } })) return false;
    return (await this.prisma.adminAccount.count()) === 0;
  }

  /** True when setup is needed but nobody has put SETUP_TOKEN into .env yet. */
  tokenMissing(): boolean {
    return !this.cfg.SETUP_TOKEN;
  }

  private async checkToken(token: string): Promise<void> {
    if (this.tokenMissing()) throw new ForbiddenException('SETUP_TOKEN is not set in .env: add it and restart core');
    const expected = await this.redis.get(SETUP_TOKEN_KEY);
    if (!expected || !safeEqual(expected, token)) throw new ForbiddenException('wrong setup token: it must match SETUP_TOKEN in .env');
  }

  async start(token: string, username: string, password: string): Promise<{ attemptId: string; totpSecret: string; otpauthUri: string; qrDataUrl: string }> {
    if (!(await this.needed())) throw new ConflictException('setup is already complete');
    await this.checkToken(token);
    if (password.length < 12) throw new UnprocessableEntityException('password must be at least 12 characters');
    const totpSecret = generateTotpSecret();
    const attemptId = randomBytes(16).toString('base64url');
    const pending: Pending = { username, passwordHash: await hashPassword(password), totpSecret };
    // One record per attempt: a second browser starting setup does not invalidate the first one's QR.
    await this.redis.set(PENDING_PREFIX + attemptId, JSON.stringify(pending), 'EX', PENDING_TTL_S);
    const uri = otpauthUri(totpSecret, username);
    return { attemptId, totpSecret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  }

  async complete(token: string, attemptId: string, code: string, ip: string): Promise<{ token: string; role: 'admin'; expiresAt: number }> {
    if (!(await this.needed())) throw new ConflictException('setup is already complete');
    await this.checkToken(token);
    const raw = await this.redis.get(PENDING_PREFIX + attemptId);
    if (!raw) throw new ConflictException('setup session expired or unknown: start again');
    const pending = JSON.parse(raw) as Pending;
    const counter = verifyTotp(pending.totpSecret, code);
    if (counter === null) throw new ForbiddenException('the code does not match: check the time on your phone and try again');
    // Exactly one bootstrap can win: the account insert and the marker are written under an advisory lock.
    const account = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin-bootstrap'))`;
      if ((await tx.setting.findUnique({ where: { key: BOOTSTRAP_SETTING } })) || (await tx.adminAccount.count()) > 0) {
        throw new ConflictException('setup was just completed from another session');
      }
      const created = await tx.adminAccount.create({ data: { username: pending.username, passwordHash: pending.passwordHash, totpSecret: pending.totpSecret, role: 'admin' } });
      await tx.setting.create({ data: { key: BOOTSTRAP_SETTING, value: new Date().toISOString(), updatedBy: `admin:admin:db:${created.id}` } });
      return created;
    });
    // The enrolment code is spent: it must not double as the first step-up code.
    await this.redis.set(`admin:totp:db:${account.id}:${counter}`, '1', 'EX', 120);
    await this.redis.del(PENDING_PREFIX + attemptId, SETUP_TOKEN_KEY);
    await this.audit.record({ actor: `admin:admin:db:${account.id}`, role: 'admin', action: 'auth.setup_complete', details: { username: account.username }, ip });
    this.log.log(`admin account "${account.username}" created by first-run setup from ${ip}`);
    const session = await this.auth.createSession({ id: `db:${account.id}`, role: 'admin' }, ip);
    return { ...session, role: 'admin' };
  }
}
