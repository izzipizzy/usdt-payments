import {
  CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { AdminRole } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { AdminAuthService } from '../admin/auth.service.js';
import { AuthFailureLimiter } from './rate-limit.js';
import { IpAllowlist } from './ip-allowlist.js';

export { credentialId } from '../config/config.js';

export interface AdminPrincipal {
  role: AdminRole;
  actor: string;
  ip: string;
  /** Credential id behind this request (session or machine token). */
  credId: string;
  kind: 'session' | 'machine';
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  admin?: AdminPrincipal;
}

const ROLE_RANK: Record<AdminRole, number> = { viewer: 1, operator: 2, admin: 3 };
const ROLE_KEY = 'required-role';
const STEP_UP_KEY = 'require-step-up';

export const RequireRole = (role: AdminRole) => SetMetadata(ROLE_KEY, role);
/** Money-moving action: with ADMIN_TOTP_STEP_UP=true the request must carry a fresh code in `X-TOTP-Code`. */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function header(req: RequestLike, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function bearer(req: RequestLike): string | null {
  const h = header(req, 'authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7);
}

function ipOf(req: RequestLike): string {
  return req.ip ?? 'unknown';
}

/**
 * Admin API: Bearer = session token from POST /admin/v1/auth/login (password + TOTP) or a machine token from
 * ADMIN_TOKENS without a TOTP secret. Role must be ≥ @RequireRole; @RequireStepUp additionally needs X-TOTP-Code
 * when ADMIN_TOTP_STEP_UP is on. The whole admin API is optionally fenced by ADMIN_ALLOWED_IPS.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly allow: IpAllowlist;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly reflector: Reflector,
    private readonly limiter: AuthFailureLimiter,
    private readonly auth: AdminAuthService,
  ) {
    this.allow = new IpAllowlist(cfg.adminAllowedIps);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestLike>();
    const ip = ipOf(req);
    if (!this.allow.allows(req.ip)) throw new ForbiddenException('admin API is not available from this address');
    const token = bearer(req);
    if (!token) throw new UnauthorizedException('missing bearer token');
    const slot = this.limiter.acquire(ip);
    if (!slot) throw new HttpException('too many failed authentication attempts', HttpStatus.TOO_MANY_REQUESTS);

    let principal: AdminPrincipal | null = null;
    const machine = this.auth.machineCredential(token);
    if (machine) principal = { role: machine.role, actor: `admin:${machine.role}:${machine.id}`, ip, credId: machine.id, kind: 'machine' };
    else {
      const session = await this.auth.resolve(token);
      if (session) principal = { role: session.role, actor: `admin:${session.role}:${session.credId}`, ip, credId: session.credId, kind: 'session' };
    }
    if (!principal) throw new UnauthorizedException('invalid or expired session');
    // Authenticated: the slot goes back. Authorization denials and step-up challenges below are not "failed logins".
    this.limiter.release(slot);

    const required = this.reflector.getAllAndOverride<AdminRole | undefined>(ROLE_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'viewer';
    if (ROLE_RANK[principal.role] < ROLE_RANK[required]) throw new ForbiddenException(`role ${principal.role} cannot perform this action (needs ${required})`);

    const stepUp = this.reflector.getAllAndOverride<boolean | undefined>(STEP_UP_KEY, [ctx.getHandler(), ctx.getClass()]) === true;
    if (stepUp && this.cfg.ADMIN_TOTP_STEP_UP) {
      const cred = await this.auth.credential(principal.credId);
      if (!cred?.totpSecret) throw new ForbiddenException('this action requires a 2FA-enabled login (machine tokens cannot step up)');
      const code = header(req, 'x-totp-code');
      if (!code) throw new HttpException({ statusCode: 428, message: 'a fresh TOTP code is required in X-TOTP-Code', error: 'step_up_required' }, HttpStatus.PRECONDITION_REQUIRED);
      // A wrong/reused code is a guess: it consumes a slot; a correct one is refunded.
      const totpSlot = this.limiter.acquire(ip);
      if (!totpSlot) throw new HttpException('too many failed authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
      if (!(await this.auth.consumeTotp(cred, code))) throw new ForbiddenException('invalid or already used TOTP code');
      this.limiter.release(totpSlot);
    }
    req.admin = principal;
    return true;
  }
}

export const Admin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminPrincipal => {
  const req = ctx.switchToHttp().getRequest<RequestLike>();
  if (!req.admin) throw new UnauthorizedException();
  return req.admin;
});
