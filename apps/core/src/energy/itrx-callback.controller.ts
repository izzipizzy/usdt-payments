import { Body, Controller, Headers, HttpCode, Inject, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { itrxVerify } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Callbacks older/newer than this are rejected: a captured callback cannot be replayed forever. */
const MAX_CLOCK_SKEW_MS = 10 * 60_000;

/**
 * itrx.io delegation callback. Verified with the same HMAC scheme as requests, using the same secret the
 * outgoing requests use (admin-UI setting first, env second).
 * It is informational: the sweep pipeline trusts getaccountresource, not this callback.
 */
@Controller('v1/callbacks')
export class ItrxCallbackController {
  private readonly log = new Logger(ItrxCallbackController.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Post('itrx')
  @HttpCode(200)
  async itrx(@Body() body: Record<string, unknown>, @Headers('signature') signature?: string, @Headers('timestamp') timestamp?: string) {
    const secret = (await this.settings.raw()).itrxApiSecret || this.cfg.ITRX_API_SECRET;
    if (!secret) throw new UnauthorizedException('itrx not configured');
    if (!signature || !timestamp || !/^\d{1,13}$/.test(timestamp) || !itrxVerify(secret, timestamp, body, signature)) {
      throw new UnauthorizedException('bad signature');
    }
    const tsMs = timestamp.length > 10 ? Number(timestamp) : Number(timestamp) * 1000;
    if (Math.abs(Date.now() - tsMs) > MAX_CLOCK_SKEW_MS) throw new UnauthorizedException('stale timestamp');
    const serial = String(body.serial ?? body.order_id ?? '');
    const outTradeNo = body.out_trade_no ? String(body.out_trade_no) : null;
    const status = Number(body.status ?? 0);
    const op =
      (serial ? await this.prisma.resourceOperation.findUnique({ where: { provider_externalOrderId: { provider: 'itrx', externalOrderId: serial } } }) : null) ??
      (outTradeNo ? await this.prisma.resourceOperation.findUnique({ where: { idempotencyKey: outTradeNo } }) : null);
    if (!op) {
      this.log.warn(`itrx callback for unknown order ${serial || outTradeNo}`);
      return { ok: true };
    }
    const payload = { ...((op.providerPayload ?? {}) as Record<string, unknown>), callback: body };
    if (status === 40 && op.status === 'requested') {
      await this.prisma.resourceOperation.update({ where: { id: op.id }, data: { providerPayload: payload as object } });
    } else if (status === 41) {
      await this.prisma.resourceOperation.update({
        where: { id: op.id },
        data: { providerPayload: payload as object, lastError: `itrx callback status 41: ${String(body.message ?? body.msg ?? '')}` },
      });
    } else {
      await this.prisma.resourceOperation.update({ where: { id: op.id }, data: { providerPayload: payload as object } });
    }
    return { ok: true };
  }
}
