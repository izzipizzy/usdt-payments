import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../config/config.js';
import { AuthFailureLimiter } from '../common/rate-limit.js';
import { IpAllowlist } from '../common/ip-allowlist.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AdminSetupService } from './setup.service.js';
import { TronNodeClient } from '../tron/tron-node.client.js';

const StartBody = z.object({
  setupToken: z.string().min(8).max(256),
  username: z.string().min(2).max(64).regex(/^[A-Za-z0-9._@-]+$/, 'letters, digits, . _ @ -'),
  password: z.string().min(12).max(512),
});
const CompleteBody = z.object({ setupToken: z.string().min(8).max(256), attemptId: z.string().min(8).max(128), code: z.string().min(6).max(8) });

interface ReqLike {
  ip?: string;
}

interface RpcProbe {
  ok: boolean;
  block: number | null;
  latencyMs: number;
  error: string | null;
}

/** First-run setup page endpoints (unauthenticated by nature; token-gated, IP-fenced and rate-limited). */
@Controller('admin/v1/setup')
export class AdminSetupController {
  private readonly allow: IpAllowlist;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly setup: AdminSetupService,
    private readonly limiter: AuthFailureLimiter,
    private readonly node: TronNodeClient,
  ) {
    this.allow = new IpAllowlist(cfg.adminAllowedIps);
  }

  private rpcCache: { at: number; value: RpcProbe } | null = null;

  /** Live check of the configured RPC: can we read the head block, and is a TronGrid key configured. */
  private async probeRpc(): Promise<RpcProbe> {
    if (this.rpcCache && Date.now() - this.rpcCache.at < 10_000) return this.rpcCache.value;
    const started = Date.now();
    let value: RpcProbe;
    try {
      const block = await this.node.getNowBlock();
      value = { ok: true, block: block.number, latencyMs: Date.now() - started, error: null };
    } catch (e) {
      value = { ok: false, block: null, latencyMs: Date.now() - started, error: (e as Error).message.slice(0, 300) };
    }
    this.rpcCache = { at: Date.now(), value };
    return value;
  }

  private fence(req: ReqLike): string {
    const ip = req.ip ?? 'unknown';
    if (!this.allow.allows(req.ip)) throw new HttpException('admin API is not available from this address', HttpStatus.FORBIDDEN);
    return ip;
  }

  @Get('status')
  async status(@Req() req: ReqLike) {
    this.fence(req);
    const needed = await this.setup.needed();
    const rpc = await this.probeRpc();
    const urls = this.cfg.rpcUrls;
    return {
      needed,
      tokenMissing: needed && this.setup.tokenMissing(),
      network: this.cfg.network,
      rpc: { urls, provider: urls.every((u) => /trongrid\.io/.test(u)) ? 'trongrid' : 'custom', apiKeySet: Boolean(this.cfg.TRONGRID_API_KEY), ...rpc },
    };
  }

  @Post('start')
  @HttpCode(200)
  async start(@Body(new ZodPipe(StartBody)) body: z.infer<typeof StartBody>, @Req() req: ReqLike) {
    const ip = this.fence(req);
    const slot = this.limiter.acquire(ip);
    if (!slot) throw new HttpException('too many failed attempts', HttpStatus.TOO_MANY_REQUESTS);
    const res = await this.setup.start(body.setupToken, body.username, body.password);
    this.limiter.release(slot);
    return res;
  }

  @Post('complete')
  @HttpCode(200)
  async complete(@Body(new ZodPipe(CompleteBody)) body: z.infer<typeof CompleteBody>, @Req() req: ReqLike) {
    const ip = this.fence(req);
    const slot = this.limiter.acquire(ip);
    if (!slot) throw new HttpException('too many failed attempts', HttpStatus.TOO_MANY_REQUESTS);
    const res = await this.setup.complete(body.setupToken, body.attemptId, body.code, ip);
    this.limiter.release(slot);
    return res;
  }
}
