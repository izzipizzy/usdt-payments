import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { DeriveResponse, SignResponse, type TronTxJson } from '@usdt-trx/shared';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../config/config.js';

export class SignerPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SignerPolicyError';
  }
}

export interface WalletStatus {
  initialized: boolean;
  network: string;
  xpub: string | null;
  poolAddress: string | null;
  /** Main wallet (account 2): payouts go out from here; sweeps land here unless an external collector is set. */
  payoutAddress: string | null;
  mainAddress: string | null;
  collectorAddress: string | null;
  collectorExternal: boolean;
  mainPath?: string;
  poolPath?: string;
}

export class SignerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignerUnavailableError';
  }
}

const BatchResponse = z.object({ items: z.array(DeriveResponse) });
const XpubResponse = z.object({ xpub: z.string(), path: z.string(), network: z.string() });

@Injectable()
export class SignerClient {
  private readonly base: string;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.base = cfg.SIGNER_URL.replace(/\/+$/, '');
  }

  private async request<T>(path: string, body: unknown | undefined, schema: z.ZodType<T>, method: 'POST' | 'GET' = 'POST'): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.SIGNER_TOKEN}` },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new SignerUnavailableError(`signer unreachable: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (res.status === 403 || res.status === 409 || res.status === 422) {
      const j = JSON.parse(text) as { code?: string; message?: string };
      throw new SignerPolicyError(j.code ?? 'POLICY', j.message ?? 'signer refused');
    }
    if (res.status === 401) throw new SignerUnavailableError('signer rejected our token (401)');
    if (!res.ok) throw new SignerUnavailableError(`signer HTTP ${res.status}: ${text.slice(0, 200)}`);
    return schema.parse(JSON.parse(text));
  }

  health(): Promise<{ ok: boolean; network: string; collector: string; pool: string | null }> {
    return this.request('/health', undefined, z.object({ ok: z.boolean(), network: z.string(), collector: z.string(), pool: z.string().nullable() }), 'GET');
  }

  walletStatus(): Promise<WalletStatus> {
    return this.request(
      '/v1/wallet',
      undefined,
      z.object({
        initialized: z.boolean(),
        network: z.string(),
        xpub: z.string().nullable(),
        poolAddress: z.string().nullable(),
        payoutAddress: z.string().nullable(),
        mainAddress: z.string().nullable(),
        collectorAddress: z.string().nullable(),
        collectorExternal: z.boolean(),
        mainPath: z.string().optional(),
        poolPath: z.string().optional(),
      }),
      'GET',
    );
  }

  /** Two-hop payout signing: stage 1 main → hop(tempIndex), stage 2 hop(tempIndex) → recipient. */
  signPayout(transaction: TronTxJson, stage: 1 | 2, tempIndex: number, purpose: string): Promise<SignResponse> {
    return this.request('/v1/sign/payout', { transaction, stage, tempIndex, purpose }, SignResponse);
  }

  deriveTemp(index: number): Promise<DeriveResponse> {
    return this.request('/v1/derive/temp', { index }, DeriveResponse);
  }

  walletCreate(words: 12 | 24): Promise<{ mnemonic: string; xpub: string; firstAddress: string }> {
    return this.request('/v1/wallet/create', { words }, z.object({ mnemonic: z.string(), xpub: z.string(), firstAddress: z.string() }));
  }

  walletImport(mnemonic: string): Promise<{ xpub: string; firstAddress: string }> {
    return this.request('/v1/wallet/import', { mnemonic }, z.object({ xpub: z.string(), firstAddress: z.string() }));
  }

  xpub(): Promise<{ xpub: string; path: string; network: string }> {
    return this.request('/v1/xpub', undefined, XpubResponse, 'GET');
  }

  derive(index: number): Promise<DeriveResponse> {
    return this.request('/v1/derive', { index }, DeriveResponse);
  }

  async deriveBatch(indices: number[]): Promise<DeriveResponse[]> {
    if (indices.length === 0) return [];
    const res = await this.request('/v1/derive/batch', { indices }, BatchResponse);
    return res.items;
  }

  signSweep(index: number, transaction: TronTxJson, sweepId: string): Promise<SignResponse> {
    return this.request('/v1/sign/sweep', { index, transaction, sweepId }, SignResponse);
  }

  signPool(transaction: TronTxJson, purpose: string): Promise<SignResponse> {
    return this.request('/v1/sign/pool', { transaction, purpose }, SignResponse);
  }
}

/** Where sweeps go: COLLECTOR_ADDRESS from env, else the main wallet reported by the signer. Cached 30 s. */
@Injectable()
export class CollectorService {
  private cache: { value: string | null; at: number } = { value: null, at: 0 };

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly signer: SignerClient,
  ) {}

  external(): boolean {
    return Boolean(this.cfg.COLLECTOR_ADDRESS);
  }

  async get(): Promise<string | null> {
    if (this.cfg.COLLECTOR_ADDRESS) return this.cfg.COLLECTOR_ADDRESS;
    if (Date.now() - this.cache.at < 30_000) return this.cache.value;
    try {
      const st = await this.signer.walletStatus();
      this.cache = { value: st.initialized ? st.collectorAddress : null, at: Date.now() };
    } catch {
      this.cache = { value: this.cache.value, at: Date.now() - 20_000 };
    }
    return this.cache.value;
  }

  /** Throws when the wallet has not been set up yet. */
  async require(): Promise<string> {
    const c = await this.get();
    if (!c) throw new Error('collector not available: the wallet is not set up yet');
    return c;
  }

  invalidate(): void {
    this.cache = { value: null, at: 0 };
  }
}

@Global()
@Module({
  providers: [SignerClient, CollectorService],
  exports: [SignerClient, CollectorService],
})
export class SignerModule {}
