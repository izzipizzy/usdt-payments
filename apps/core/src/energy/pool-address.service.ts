import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { SignerClient } from '../signer/signer.client.js';

/** Where the fee-paying pool wallet lives: POOL_ADDRESS from env, else the signer's derived pool (account 1 of the phrase). */
@Injectable()
export class PoolAddressService {
  private cache: { value: string | null; at: number } = { value: null, at: 0 };

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly signer: SignerClient,
  ) {}

  async get(): Promise<string | null> {
    if (this.cfg.POOL_ADDRESS) return this.cfg.POOL_ADDRESS;
    if (Date.now() - this.cache.at < 30_000) return this.cache.value;
    try {
      const st = await this.signer.walletStatus();
      this.cache = { value: st.poolAddress, at: Date.now() };
    } catch {
      this.cache = { value: this.cache.value, at: Date.now() - 20_000 };
    }
    return this.cache.value;
  }

  invalidate(): void {
    this.cache = { value: null, at: 0 };
  }
}
