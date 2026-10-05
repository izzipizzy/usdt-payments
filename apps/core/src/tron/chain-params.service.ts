import { Injectable, Logger } from '@nestjs/common';
import { TronNodeClient } from './tron-node.client.js';

export interface ChainParams {
  energyFeeSun: number; // getEnergyFee
  bandwidthFeeSun: number; // getTransactionFee
  createAccountFeeSun: number; // getCreateNewAccountFeeInSystemContract
  createAccountBandwidthFeeSun: number; // getCreateAccountFee
  fetchedAt: Date;
}

const DEFAULTS: ChainParams = {
  energyFeeSun: 100,
  bandwidthFeeSun: 1000,
  createAccountFeeSun: 1_000_000,
  createAccountBandwidthFeeSun: 100_000,
  fetchedAt: new Date(0),
};

@Injectable()
export class ChainParamsService {
  private readonly log = new Logger(ChainParamsService.name);
  private cached: ChainParams = DEFAULTS;
  private readonly ttlMs = 10 * 60_000;

  constructor(private readonly node: TronNodeClient) {}

  async get(): Promise<ChainParams> {
    if (Date.now() - this.cached.fetchedAt.getTime() < this.ttlMs) return this.cached;
    try {
      const p = await this.node.getChainParameters();
      this.cached = {
        energyFeeSun: p.getEnergyFee ?? DEFAULTS.energyFeeSun,
        bandwidthFeeSun: p.getTransactionFee ?? DEFAULTS.bandwidthFeeSun,
        createAccountFeeSun: p.getCreateNewAccountFeeInSystemContract ?? DEFAULTS.createAccountFeeSun,
        createAccountBandwidthFeeSun: p.getCreateAccountFee ?? DEFAULTS.createAccountBandwidthFeeSun,
        fetchedAt: new Date(),
      };
    } catch (e) {
      this.log.warn(`chain parameters unavailable, using cached/defaults: ${(e as Error).message}`);
    }
    return this.cached;
  }

  /** Current view without refreshing (for dashboards). */
  peek(): ChainParams {
    return this.cached;
  }
}
