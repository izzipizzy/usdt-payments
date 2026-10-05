import { Inject, Injectable } from '@nestjs/common';
import type { ResourceOperation } from '@prisma/client';
import { BANDWIDTH_TRANSFER_BYTES, type TronTxJson } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { SettingsService } from '../settings/settings.service.js';
import { SignerClient } from '../signer/signer.client.js';
import { ChainParamsService } from '../tron/chain-params.service.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TxBuilderService } from '../tron/tx-builder.service.js';
import { PoolAddressService } from './pool-address.service.js';
import { sleep } from '../common/errors.js';
import { ProviderError, type EnergyProvider, type ProvisionRequest, type ProvisionResult } from './energy-provider.js';

/**
 * Last resort: send enough TRX to the deposit address so the sweep burns it.
 * Needs POOL_ADDRESS and the signer's POOL_MAX_TRANSFER_SUN raised above the burn amount.
 */
@Injectable()
export class BurnProvider implements EnergyProvider {
  readonly name = 'burn';
  readonly source = 'burn' as const;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly settings: SettingsService,
    private readonly node: TronNodeClient,
    private readonly signer: SignerClient,
    private readonly txb: TxBuilderService,
    private readonly params: ChainParamsService,
    private readonly poolAddr: PoolAddressService,
  ) {}

  async enabled(): Promise<boolean> {
    return (await this.poolAddr.get()) !== null && (await this.settings.get()).burnEnabled;
  }

  async health() {
    const enabled = await this.enabled();
    return { healthy: enabled, balanceSun: null, detail: enabled ? 'burn enabled (expensive fallback)' : 'disabled' };
  }

  async costSun(energy: number, activate: boolean): Promise<bigint> {
    const p = await this.params.get();
    let cost = BigInt(energy) * BigInt(p.energyFeeSun) + BigInt(BANDWIDTH_TRANSFER_BYTES) * BigInt(p.bandwidthFeeSun);
    if (activate) cost += BigInt(p.createAccountFeeSun) + BigInt(p.createAccountBandwidthFeeSun);
    return cost;
  }

  async provide(req: ProvisionRequest): Promise<ProvisionResult> {
    const amount = await this.costSun(req.energy, req.activate);
    const tx: TronTxJson = await this.txb.trxTransfer((await this.poolAddr.get())!, req.address, amount);
    const { signature } = await this.signer.signPool(tx, `burn funding ${req.address}`);
    const res = await this.node.broadcast({ ...tx, signature: [signature] });
    if (!res.ok) throw new ProviderError(`burn funding broadcast failed: ${res.code}`, this.name);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !(await this.node.getTransactionInfo(tx.txID))) await sleep(3_000);
    return { externalId: tx.txID, costSun: amount, expiresAt: null, txId: tx.txID, payload: { fundedSun: amount.toString() } };
  }

  async release(_op: ResourceOperation): Promise<void> {
    // TRX that was not burned stays on the address; nothing to reclaim.
  }
}
