import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResourceOperation } from '@prisma/client';
import { SUN_PER_TRX, type TronTxJson } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { SignerClient } from '../signer/signer.client.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TxBuilderService } from '../tron/tx-builder.service.js';
import { PoolAddressService } from './pool-address.service.js';
import { sleep } from '../common/errors.js';
import { ProviderError, type EnergyProvider, type ProvisionRequest, type ProvisionResult } from './energy-provider.js';

/**
 * Delegates energy from our own staked pool wallet (Stake 2.0, no lock → undelegate right after the sweep).
 * The pool key lives in the signer; core only builds and broadcasts.
 */
@Injectable()
export class OwnPoolProvider implements EnergyProvider {
  readonly name = 'own_pool';
  readonly source = 'own_pool' as const;
  private readonly log = new Logger(OwnPoolProvider.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly node: TronNodeClient,
    private readonly signer: SignerClient,
    private readonly txb: TxBuilderService,
    private readonly poolAddr: PoolAddressService,
  ) {}

  async enabled(): Promise<boolean> {
    return (await this.poolAddr.get()) !== null;
  }

  async health() {
    const pool = await this.poolAddr.get();
    if (!pool) return { healthy: false, balanceSun: null, detail: 'pool wallet not available (set up the wallet first)' };
    try {
      const [acc, res] = await Promise.all([this.node.getAccount(pool), this.node.getAccountResource(pool)]);
      const perTrx = res.totalEnergyWeight > 0 ? res.totalEnergyLimit / res.totalEnergyWeight : 0;
      return {
        healthy: acc !== null,
        balanceSun: acc?.balanceSun ?? null,
        detail: `energy ${res.energyAvailable}/${res.energyLimit} available, ≈${perTrx.toFixed(2)} energy per staked TRX/day`,
      };
    } catch (e) {
      return { healthy: false, balanceSun: null, detail: (e as Error).message };
    }
  }

  private async signBroadcastWait(tx: TronTxJson, purpose: string): Promise<string> {
    const { signature } = await this.signer.signPool(tx, purpose);
    const signed: TronTxJson = { ...tx, signature: [signature] };
    const res = await this.node.broadcast(signed);
    if (!res.ok) throw new ProviderError(`pool ${purpose} broadcast failed: ${res.code} ${res.message ?? ''}`, this.name, res.code === 'CONTRACT_VALIDATE_ERROR');
    // Wait until the node reports the tx (head state is enough for resource accounting).
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const info = await this.node.getTransactionInfo(tx.txID);
      if (info) {
        if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new ProviderError(`pool ${purpose} failed on-chain: ${info.receipt.result}`, this.name);
        return tx.txID;
      }
      await sleep(3_000);
    }
    throw new ProviderError(`pool ${purpose} tx ${tx.txID} not seen within 60 s`, this.name);
  }

  /** TRX (in sun) to delegate so the receiver gets `energy` for a day. */
  async delegationAmountSun(energy: number): Promise<bigint> {
    const res = await this.node.getAccountResource((await this.poolAddr.get())!);
    if (res.totalEnergyWeight <= 0 || res.totalEnergyLimit <= 0) throw new ProviderError('cannot compute energy per TRX', this.name);
    const energyPerTrx = res.totalEnergyLimit / res.totalEnergyWeight;
    const trx = Math.ceil((energy / energyPerTrx) * 1.05);
    if (res.energyAvailable < energy) {
      throw new ProviderError(`pool has ${res.energyAvailable} energy available, need ${energy}`, this.name);
    }
    return BigInt(trx) * SUN_PER_TRX;
  }

  async provide(req: ProvisionRequest): Promise<ProvisionResult> {
    const pool = await this.poolAddr.get();
    if (!pool) throw new ProviderError('pool wallet not available', this.name, true);
    const payload: Record<string, unknown> = {};
    if (req.activate) {
      const tx = await this.txb.trxTransfer(pool, req.address, this.cfg.POOL_ACTIVATION_SUN);
      payload.activationTxId = await this.signBroadcastWait(tx, `activate ${req.address}`);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && (await this.node.getAccount(req.address)) === null) await sleep(3_000);
      if ((await this.node.getAccount(req.address)) === null) throw new ProviderError('activation not visible after 60 s', this.name);
    }
    const amountSun = await this.delegationAmountSun(req.energy);
    const tx = await this.txb.delegateEnergy(pool, req.address, amountSun);
    const txId = await this.signBroadcastWait(tx, `delegate ${req.energy} energy to ${req.address}`);
    payload.delegatedSun = amountSun.toString();
    return { externalId: txId, costSun: 0n, expiresAt: null, txId, payload };
  }

  async release(op: ResourceOperation): Promise<void> {
    const payload = (op.providerPayload ?? {}) as { delegatedSun?: string };
    if (!payload.delegatedSun) return;
    try {
      const tx = await this.txb.undelegateEnergy((await this.poolAddr.get())!, op.targetAddress, BigInt(payload.delegatedSun));
      await this.signBroadcastWait(tx, `undelegate from ${op.targetAddress}`);
    } catch (e) {
      this.log.warn(`undelegate for ${op.targetAddress} failed: ${(e as Error).message}`);
    }
  }
}
