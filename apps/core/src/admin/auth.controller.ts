import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../config/config.js';
import { AuthFailureLimiter } from '../common/rate-limit.js';
import { IpAllowlist } from '../common/ip-allowlist.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AdminAuthService } from './auth.service.js';

const LoginBody = z.object({ username: z.string().min(1).max(64).optional(), password: z.string().min(1).max(512), code: z.string().min(6).max(8) });

interface ReqLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Admin UI session endpoints. Login is the only unauthenticated admin route; it is rate-limited per IP. */
@Controller('admin/v1/auth')
export class AdminAuthController {
  private readonly allow: IpAllowlist;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly auth: AdminAuthService,
    private readonly limiter: AuthFailureLimiter,
  ) {
    this.allow = new IpAllowlist(cfg.adminAllowedIps);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginBody)) body: { username?: string; password: string; code: string }, @Req() req: ReqLike) {
    const ip = req.ip ?? 'unknown';
    if (!this.allow.allows(req.ip)) throw new HttpException('admin API is not available from this address', HttpStatus.FORBIDDEN);
    const slot = this.limiter.acquire(ip);
    if (!slot) throw new HttpException('too many failed authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
    const res = await this.auth.login(body.password, body.code, ip, body.username);
    this.limiter.release(slot);
    return res;
  }

  /** Revocation must work even while the IP is locked out, so it bypasses AdminGuard and only needs the token itself. */
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: ReqLike) {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');
    const token = header.slice(7);
    const session = await this.auth.resolve(token);
    if (!session) return { ok: true, revoked: false };
    await this.auth.logout(token, `admin:${session.role}:${session.credId}`, req.ip ?? 'unknown');
    return { ok: true, revoked: true };
  }
}
