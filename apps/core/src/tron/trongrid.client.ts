import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';

export interface Trc20Transfer {
  txId: string;
  from: string;
  to: string;
  /** Raw token units (10⁻⁶ USDT). */
  value: bigint;
  timestampMs: number;
}

/**
 * TronGrid account-history API (what Tronscan shows): every USDT transfer touching an address in one paginated
 * call instead of a block-by-block scan. Used only for recovery/backfill; the watcher stays the source of truth
 * for live deposits.
 */
@Injectable()
export class TronGridClient {
  private readonly log = new Logger(TronGridClient.name);
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.base = (cfg.TRONGRID_API_URL ?? (cfg.network === 'mainnet' ? 'https://api.trongrid.io' : 'https://nile.trongrid.io')).replace(/\/+$/, '');
    this.headers = { accept: 'application/json' };
    if (cfg.TRONGRID_API_KEY) this.headers['TRON-PRO-API-KEY'] = cfg.TRONGRID_API_KEY;
  }

  /** All USDT transfers in and out of `address`, oldest first. */
  async usdtTransfers(address: string, maxPages = 50): Promise<Trc20Transfer[]> {
    const out: Trc20Transfer[] = [];
    let fingerprint: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`${this.base}/v1/accounts/${address}/transactions/trc20`);
      url.searchParams.set('limit', '200');
      url.searchParams.set('contract_address', this.cfg.usdtContract);
      url.searchParams.set('order_by', 'block_timestamp,asc');
      if (fingerprint) url.searchParams.set('fingerprint', fingerprint);
      const res = await fetch(url, { headers: this.headers, signal: AbortSignal.timeout(this.cfg.TRON_HTTP_TIMEOUT_MS) });
      const text = await res.text();
      if (!res.ok) throw new Error(`TronGrid ${res.status} for ${address}: ${text.slice(0, 200)}`);
      const body = JSON.parse(text) as {
        success?: boolean;
        data?: Array<{ transaction_id: string; from: string; to: string; value: string; block_timestamp: number; type?: string; token_info?: { address?: string } }>;
        meta?: { fingerprint?: string };
      };
      for (const t of body.data ?? []) {
        if (t.type && t.type !== 'Transfer') continue;
        if (t.token_info?.address && t.token_info.address !== this.cfg.usdtContract) continue;
        out.push({ txId: t.transaction_id.toLowerCase(), from: t.from, to: t.to, value: BigInt(t.value), timestampMs: t.block_timestamp });
      }
      fingerprint = body.meta?.fingerprint;
      if (!fingerprint) break;
    }
    return out.sort((a, b) => a.timestampMs - b.timestampMs);
  }
}
