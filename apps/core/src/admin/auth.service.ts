import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Redis } from 'ioredis';
import { CONFIG, type AdminCredential, type AppConfig } from '../config/config.js';
import { REDIS } from '../infra/redis.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { verifyPassword } from '../common/password.js';
import { verifyTotp } from '../common/totp.js';

export interface AdminSession {
  credId: string;
  role: AdminCredential['role'];
  createdAt: number;
  expiresAt: number;
}

/** A real scrypt hash of a random password; only used to equalise timing for unknown usernames. */
const DUMMY_HASH = 'scrypt$32768$8$1$0f9a6a1c3b7d2e4f5a6b7c8d9e0f1a2b$8b7d5e2c4a6f1b3d9e0c2a4f6b8d1e3c5a7f9b0d2e4c6a8f1b3d5e7c9a0b2d4f';
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Admin login = password + TOTP → opaque session token stored in Redis (revocable, expiring).
 * Static ADMIN_TOKENS entries without a TOTP secret remain machine tokens and never go through here.
 */
@Injectable()
export class AdminAuthService {
  private readonly log = new Logger(AdminAuthService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private sessionKey(token: string): string {
    return `admin:session:${createHash('sha256').update(token).digest('hex')}`;
  }

  /** Credential behind a session: env entry, or a `db:<id>` account created by the setup page. */
  async credential(id: string): Promise<AdminCredential | undefined> {
    const env = this.cfg.adminCredentials.find((c) => c.id === id);
    if (env) return env;
    if (!id.startsWith('db:') || !/^\d+$/.test(id.slice(3))) return undefined;
    const row = await this.prisma.adminAccount.findUnique({ where: { id: BigInt(id.slice(3)) } });
    if (!row || row.disabled) return undefined;
    return { id, secret: '', role: row.role, totpSecret: row.totpSecret };
  }

  /** Password check across env logins and DB accounts (few rows; every account is checked to keep timing flat). */
  private async findByPassword(password: string, username?: string): Promise<AdminCredential | undefined> {
    const env = this.cfg.adminCredentials.find((c) => c.totpSecret && safeEqual(c.secret, password));
    if (env) return env;
    const rows = await this.prisma.adminAccount.findMany({ where: { disabled: false, ...(username ? { username } : {}) } });
    let match: AdminCredential | undefined;
    for (const row of rows) {
      if ((await verifyPassword(password, row.passwordHash)) && !match) match = { id: `db:${row.id}`, secret: '', role: row.role, totpSecret: row.totpSecret };
    }
    // Unknown/disabled username: burn the same scrypt work so the response time does not reveal which usernames exist.
    if (rows.length === 0) await verifyPassword(password, DUMMY_HASH);
    return match;
  }

  async createSession(cred: { id: string; role: AdminCredential['role'] }, ip: string): Promise<{ token: string; role: AdminCredential['role']; expiresAt: number }> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session: AdminSession = { credId: cred.id, role: cred.role, createdAt: now, expiresAt: now + this.cfg.ADMIN_SESSION_TTL_MS };
    await this.redis.set(this.sessionKey(token), JSON.stringify(session), 'PX', this.cfg.ADMIN_SESSION_TTL_MS);
    await this.audit.record({ actor: `admin:${cred.role}:${cred.id}`, role: cred.role, action: 'auth.login', ip });
    if (cred.id.startsWith('db:')) await this.prisma.adminAccount.update({ where: { id: BigInt(cred.id.slice(3)) }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
    this.log.log(`admin login: ${cred.role} ${cred.id} from ${ip}`);
    return { token, role: cred.role, expiresAt: session.expiresAt };
  }

  /** Machine token (no TOTP) presented directly as Bearer. */
  machineCredential(token: string): AdminCredential | undefined {
    return this.cfg.adminCredentials.find((c) => !c.totpSecret && safeEqual(c.secret, token));
  }

  /**
   * Verify a TOTP code for a credential and burn the matched time step so the same code cannot be used twice
   * (for login or step-up) within its validity window.
   */
  async consumeTotp(cred: AdminCredential, code: string): Promise<boolean> {
    if (!cred.totpSecret) return false;
    const counter = verifyTotp(cred.totpSecret, code);
    if (counter === null) return false;
    const fresh = await this.redis.set(`admin:totp:${cred.id}:${counter}`, '1', 'EX', 120, 'NX');
    return fresh === 'OK';
  }

  async login(password: string, code: string, ip: string, username?: string): Promise<{ token: string; role: AdminCredential['role']; expiresAt: number }> {
    const cred = await this.findByPassword(password, username);
    if (!cred) {
      // Burn time comparably to the TOTP path so a wrong password is not distinguishable by timing.
      verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', code);
      await this.audit.record({ actor: 'anonymous', action: 'auth.login_failed', details: { reason: 'password' }, ip });
      throw new UnauthorizedException('invalid password or code');
    }
    if (!(await this.consumeTotp(cred, code))) {
      await this.audit.record({ actor: `admin:${cred.role}:${cred.id}`, action: 'auth.login_failed', details: { reason: 'totp' }, ip });
      throw new UnauthorizedException('invalid password or code');
    }
    return this.createSession(cred, ip);
  }

  /** Session → principal. The credential is re-resolved every time: a removed/disabled/demoted account loses access at once. */
  async resolve(token: string): Promise<AdminSession | null> {
    const raw = await this.redis.get(this.sessionKey(token));
    if (!raw) return null;
    const s = JSON.parse(raw) as AdminSession;
    if (s.expiresAt <= Date.now()) return null;
    const cred = await this.credential(s.credId);
    if (!cred?.totpSecret) {
      await this.redis.del(this.sessionKey(token));
      return null;
    }
    return { ...s, role: cred.role };
  }

  async logout(token: string, actor: string, ip: string): Promise<void> {
    await this.redis.del(this.sessionKey(token));
    await this.audit.record({ actor, action: 'auth.logout', ip });
  }
}
