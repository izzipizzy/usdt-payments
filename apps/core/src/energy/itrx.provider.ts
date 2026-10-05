import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResourceOperation } from '@prisma/client';
import { itrxSign } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { SettingsService } from '../settings/settings.service.js';
import { CollectorService, SignerClient } from '../signer/signer.client.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TxBuilderService } from '../tron/tx-builder.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PoolAddressService } from './pool-address.service.js';
import { sleep } from '../common/errors.js';
import { ProviderError, type EnergyProvider, type ProvisionRequest, type ProvisionResult } from './energy-provider.js';

interface ItrxOrderResponse {
  errno: number;
  serial?: string;
  amount?: number;
  balance?: number;
  message?: string;
}

interface ItrxPriceResponse {
  period?: string;
  energy_amount?: number;
  price?: number;
  total_price?: number;
  addition?: number;
  errno?: number;
  message?: string;
}

export function isInsufficientFunds(e: unknown): boolean {
  return /insufficient funds|insufficient balance/i.test((e as Error)?.message ?? '');
}

/**
 * How much TRX to send so the NEXT order goes through: exact shortfall + a small reserve, clamped to
 * [ITRX_TOPUP_MIN_SUN, ITRX_TOPUP_MAX_SUN]. `knownBalance` is null when we have not seen an order response yet.
 */
export function topUpAmount(orderCostSun: bigint, knownBalance: bigint | null, cfg: { ITRX_TOPUP_RESERVE_SUN: bigint; ITRX_TOPUP_MIN_SUN: bigint; ITRX_TOPUP_MAX_SUN: bigint }): bigint {
  const shortfall = orderCostSun - (knownBalance ?? 0n) + cfg.ITRX_TOPUP_RESERVE_SUN;
  const clamped = shortfall < cfg.ITRX_TOPUP_MIN_SUN ? cfg.ITRX_TOPUP_MIN_SUN : shortfall;
  return clamped > cfg.ITRX_TOPUP_MAX_SUN ? cfg.ITRX_TOPUP_MAX_SUN : clamped;
}

/**
 * itrx.io energy rental (https://develop.itrx.io).
 * GET endpoints need only API-KEY; POST endpoints are signed with HMAC-SHA256 over "{timestamp}&{sortedJson}".
 * Payment is taken from the prepaid TRX balance of the itrx account.
 */
@Injectable()
export class ItrxProvider implements EnergyProvider {
  readonly name = 'itrx';
  readonly source = 'rental' as const;
  private readonly log = new Logger(ItrxProvider.name);
  private lastBalanceSun: bigint | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly settings: SettingsService,
    private readonly collector: CollectorService,
    private readonly signer: SignerClient,
    private readonly node: TronNodeClient,
    private readonly txb: TxBuilderService,
    private readonly prisma: PrismaService,
    private readonly poolAddr: PoolAddressService,
  ) {}

  private async creds(): Promise<{ key: string; secret: string; period: '1H' | '1D' }> {
    const s = await this.settings.raw();
    return { key: s.itrxApiKey, secret: s.itrxApiSecret, period: s.itrxRentPeriod };
  }

  async enabled(): Promise<boolean> {
    const c = await this.creds();
    return Boolean(c.key && c.secret);
  }

  private url(path: string, query?: Record<string, string | number>): string {
    const u = new URL(path, this.cfg.ITRX_BASE_URL);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    const { key } = await this.creds();
    const res = await fetch(this.url(path, query), { headers: { 'API-KEY': key }, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(`itrx GET ${path} HTTP ${res.status}: ${text.slice(0, 200)}`, this.name);
    return JSON.parse(text) as T;
  }

  private async post<T>(path: string, data: Record<string, unknown>): Promise<T> {
    const { key, secret } = await this.creds();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = itrxSign(secret, timestamp, data);
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(data).sort()) sorted[k] = data[k];
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'API-KEY': key,
        TIMESTAMP: String(timestamp),
        SIGNATURE: signature,
      },
      body: JSON.stringify(sorted),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(`itrx POST ${path} HTTP ${res.status}: ${text.slice(0, 200)}`, this.name);
    return JSON.parse(text) as T;
  }

  async quote(address: string, energy: number): Promise<{ unitPriceSun: number; totalSun: bigint; additionSun: bigint }> {
    const { period } = await this.creds();
    const r = await this.get<ItrxPriceResponse>('order/price', { period, energy_amount: energy, to_address: address });
    if (r.errno && r.errno !== 0) throw new ProviderError(`itrx price errno ${r.errno}: ${r.message ?? ''}`, this.name);
    return { unitPriceSun: r.price ?? 0, totalSun: BigInt(r.total_price ?? 0), additionSun: BigInt(r.addition ?? 0) };
  }

  async health() {
    try {
      const q = await this.quote((await this.collector.get()) ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 65_000);
      this.lastError = null;
      return { healthy: true, balanceSun: this.lastBalanceSun, detail: `65k energy ≈ ${Number(q.totalSun) / 1e6} TRX (${q.unitPriceSun} sun/energy, ${(await this.creds()).period})` };
    } catch (e) {
      this.lastError = (e as Error).message;
      return { healthy: false, balanceSun: this.lastBalanceSun, detail: this.lastError };
    }
  }

  /** Connection test for the admin UI: price quote for one transfer + last known balance. */
  async test(): Promise<{ ok: boolean; detail: string; unitPriceSun: number | null; transferCostTrx: string | null; balanceTrx: string | null }> {
    if (!(await this.enabled())) return { ok: false, detail: 'API key or secret is not set', unitPriceSun: null, transferCostTrx: null, balanceTrx: null };
    try {
      const q = await this.quote((await this.collector.get()) ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 65_000);
      return {
        ok: true,
        detail: `65 000 energy for ${(await this.creds()).period}`,
        unitPriceSun: q.unitPriceSun,
        transferCostTrx: (Number(q.totalSun + q.additionSun) / 1e6).toFixed(2),
        balanceTrx: this.lastBalanceSun === null ? null : (Number(this.lastBalanceSun) / 1e6).toFixed(2),
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message, unitPriceSun: null, transferCostTrx: null, balanceTrx: null };
    }
  }

  async provide(req: ProvisionRequest): Promise<ProvisionResult> {
    try {
      return await this.placeOrder(req);
    } catch (e) {
      if (!isInsufficientFunds(e) || !this.cfg.ITRX_DEPOSIT_ADDRESS) throw e;
      // Prepaid balance is short: top it up from the pool wallet by exactly what this order needs, then retry.
      const q = await this.quote(req.address, req.energy);
      const amount = topUpAmount(q.totalSun + q.additionSun, this.lastBalanceSun, this.cfg);
      await this.topUp(amount, req);
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(15_000); // itrx credits the deposit after the transfer is confirmed, usually within a minute
        try {
          return await this.placeOrder(req);
        } catch (e2) {
          if (!isInsufficientFunds(e2)) throw e2;
        }
      }
      throw new ProviderError('itrx balance was topped up but not credited within 2 minutes; will retry', this.name);
    }
  }

  private async placeOrder(req: ProvisionRequest): Promise<ProvisionResult> {
    const { period } = await this.creds();
    const data: Record<string, unknown> = {
      energy_amount: req.energy,
      period,
      receive_address: req.address,
      out_trade_no: req.idempotencyKey,
    };
    if (req.activate) data.active = 1;
    if (this.cfg.ITRX_CALLBACK_URL) data.callback_url = this.cfg.ITRX_CALLBACK_URL;
    const r = await this.post<ItrxOrderResponse>('order', data);
    if (r.balance !== undefined) {
      this.lastBalanceSun = BigInt(r.balance);
      if (this.lastBalanceSun < this.cfg.ITRX_MIN_BALANCE_SUN) {
        this.log.warn(`itrx prepaid balance low: ${Number(this.lastBalanceSun) / 1e6} TRX`);
      }
    }
    if (r.errno !== 0 || !r.serial) {
      throw new ProviderError(`itrx order failed errno=${r.errno}: ${r.message ?? 'no message'}`, this.name, /balance/i.test(r.message ?? ''));
    }
    const ttlMs = period === '1H' ? 3_600_000 : 86_400_000;
    return {
      externalId: r.serial,
      costSun: BigInt(r.amount ?? 0),
      expiresAt: new Date(Date.now() + ttlMs),
      txId: null,
      payload: { order: r as unknown as Record<string, unknown> },
    };
  }

  /** Pool wallet → itrx deposit address. The signer only allows this amount because the address is in POOL_TRUSTED_RECIPIENTS. */
  private async topUp(amountSun: bigint, req: ProvisionRequest): Promise<void> {
    const pool = await this.poolAddr.get();
    const to = this.cfg.ITRX_DEPOSIT_ADDRESS!;
    if (!pool) throw new ProviderError('itrx top-up needs the pool wallet', this.name, true);
    const acc = await this.node.getAccount(pool);
    if (!acc || acc.balanceSun < amountSun + 1_000_000n) {
      throw new ProviderError(`itrx balance is short and the pool wallet holds ${acc ? Number(acc.balanceSun) / 1e6 : 0} TRX, needs ${Number(amountSun) / 1e6} TRX + fees`, this.name);
    }
    const tx = await this.txb.trxTransfer(pool, to, amountSun);
    const { signature } = await this.signer.signPool(tx, `itrx top-up ${Number(amountSun) / 1e6} TRX for ${req.idempotencyKey}`);
    const bc = await this.node.broadcast({ ...tx, signature: [signature] });
    if (!bc.ok) throw new ProviderError(`itrx top-up broadcast failed: ${bc.code} ${bc.message ?? ''}`, this.name);
    await this.prisma.resourceOperation.create({
      data: { targetAddress: to, kind: 'send_trx', provider: 'itrx', idempotencyKey: `itrx-topup-${tx.txID}`, status: 'delivered', txId: tx.txID, externalOrderId: tx.txID, costSun: amountSun, providerPayload: { for: req.idempotencyKey, toppedUpSun: amountSun.toString() } },
    });
    this.log.log(`itrx top-up: ${Number(amountSun) / 1e6} TRX from the pool to ${to} (${tx.txID})`);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !(await this.node.getTransactionInfo(tx.txID))) await sleep(3_000);
    this.lastBalanceSun = null; // unknown until the next order response
  }

  async release(op: ResourceOperation): Promise<void> {
    if (!op.externalOrderId) return;
    try {
      await this.post('order/reclaim', { serial: op.externalOrderId });
    } catch (e) {
      this.log.warn(`itrx reclaim ${op.externalOrderId} failed: ${(e as Error).message}`);
    }
  }
}
