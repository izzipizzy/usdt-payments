import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ENERGY_TRANSFER_NONZERO_RECIPIENT, SUN_PER_TRX, buildFreezeBalanceV2Tx, buildUnfreezeBalanceV2Tx, formatTrx, parseTrx, type TronTxJson } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { SignerClient, SignerPolicyError } from '../signer/signer.client.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TxBuilderService } from '../tron/tx-builder.service.js';
import { AuditService } from '../common/audit.service.js';
import { explorerAddress, explorerTx } from '../common/explorer.js';
import { sleep } from '../common/errors.js';
import { PoolAddressService } from './pool-address.service.js';

export interface PoolStatus {
  configured: boolean;
  reason?: string;
  address?: string;
  explorerUrl?: string;
  activated?: boolean;
  trxBalance?: string;
  trxBalanceSun?: string;
  energyLimit?: number;
  energyUsed?: number;
  energyAvailable?: number;
  bandwidthAvailable?: number;
  stakedForEnergyTrx?: string;
  stakedForBandwidthTrx?: string;
  delegatedOutEnergyTrx?: string;
  energyPerTrxPerDay?: number;
  estimatedSweepsPerDay?: number;
}

/** Operator view and Stake 2.0 operations for the own energy pool wallet. */
@Injectable()
export class PoolService {
  private readonly log = new Logger(PoolService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly node: TronNodeClient,
    private readonly signer: SignerClient,
    private readonly txb: TxBuilderService,
    private readonly audit: AuditService,
    private readonly poolAddr: PoolAddressService,
  ) {}

  async status(): Promise<PoolStatus> {
    const address = await this.poolAddr.get();
    if (!address) return { configured: false, reason: 'pool wallet not available yet: set up the wallet first' };
    const [acc, res] = await Promise.all([this.node.getAccount(address), this.node.getAccountResource(address)]);
    const raw = (acc?.raw ?? {}) as {
      frozenV2?: Array<{ type?: string; amount?: number }>;
      account_resource?: { delegated_frozenV2_balance_for_energy?: number };
    };
    const frozen = raw.frozenV2 ?? [];
    const stakedEnergy = BigInt(frozen.find((f) => f.type === 'ENERGY')?.amount ?? 0);
    const stakedBandwidth = BigInt(frozen.find((f) => f.type === undefined || f.type === 'BANDWIDTH')?.amount ?? 0);
    const delegatedEnergy = BigInt(raw.account_resource?.delegated_frozenV2_balance_for_energy ?? 0);
    const perTrx = res.totalEnergyWeight > 0 ? res.totalEnergyLimit / res.totalEnergyWeight : 0;
    return {
      configured: true,
      address,
      explorerUrl: explorerAddress(this.cfg.network, address),
      activated: acc !== null,
      trxBalance: formatTrx(acc?.balanceSun ?? 0n),
      trxBalanceSun: (acc?.balanceSun ?? 0n).toString(),
      energyLimit: res.energyLimit,
      energyUsed: res.energyUsed,
      energyAvailable: res.energyAvailable,
      bandwidthAvailable: res.bandwidthAvailable,
      stakedForEnergyTrx: formatTrx(stakedEnergy),
      stakedForBandwidthTrx: formatTrx(stakedBandwidth),
      delegatedOutEnergyTrx: formatTrx(delegatedEnergy),
      energyPerTrxPerDay: Number(perTrx.toFixed(2)),
      estimatedSweepsPerDay: Math.floor(res.energyLimit / ENERGY_TRANSFER_NONZERO_RECIPIENT),
    };
  }

  private async signBroadcastWait(tx: TronTxJson, purpose: string): Promise<string> {
    let signature: string;
    try {
      ({ signature } = await this.signer.signPool(tx, purpose));
    } catch (e) {
      if (e instanceof SignerPolicyError) throw new ConflictException(`signer refused: ${e.code} ${e.message}`);
      throw new ConflictException(`signer unavailable: ${(e as Error).message}`);
    }
    const res = await this.node.broadcast({ ...tx, signature: [signature] });
    if (!res.ok) throw new ConflictException(`broadcast failed: ${res.code} ${res.message ?? ''}`);
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const info = await this.node.getTransactionInfo(tx.txID);
      if (info) {
        if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new ConflictException(`on-chain ${info.receipt.result}`);
        return tx.txID;
      }
      await sleep(3_000);
    }
    return tx.txID; // broadcast accepted; inclusion will show up on the explorer
  }

  async stake(amountTrx: string, resource: 'ENERGY' | 'BANDWIDTH', actor: string, ip?: string): Promise<{ txId: string; explorerUrl: string }> {
    const address = await this.requireConfigured();
    const amountSun = parseTrx(amountTrx);
    if (amountSun < SUN_PER_TRX) throw new ConflictException('minimum stake is 1 TRX');
    const acc = await this.node.getAccount(address);
    if (!acc) throw new ConflictException('pool wallet is not activated (send it some TRX first)');
    if (acc.balanceSun < amountSun + SUN_PER_TRX) throw new ConflictException(`pool balance ${formatTrx(acc.balanceSun)} TRX is not enough for ${amountTrx} TRX (+1 TRX reserve)`);
    const tx = await buildFreezeBalanceV2Tx({ owner: address, amountSun, resource, blockHeader: await this.txb.header(60_000) });
    const txId = await this.signBroadcastWait(tx, `stake ${amountTrx} TRX for ${resource}`);
    await this.audit.record({ actor, action: 'pool.stake', subjectType: 'pool', subjectId: address, details: { amountTrx, resource, txId }, ip });
    this.log.log(`pool staked ${amountTrx} TRX for ${resource}: ${txId}`);
    return { txId, explorerUrl: explorerTx(this.cfg.network, txId) };
  }

  async unstake(amountTrx: string, resource: 'ENERGY' | 'BANDWIDTH', actor: string, ip?: string): Promise<{ txId: string; explorerUrl: string }> {
    const address = await this.requireConfigured();
    const amountSun = parseTrx(amountTrx);
    if (amountSun <= 0n) throw new ConflictException('amount must be positive');
    const tx = await buildUnfreezeBalanceV2Tx({ owner: address, amountSun, resource, blockHeader: await this.txb.header(60_000) });
    const txId = await this.signBroadcastWait(tx, `unstake ${amountTrx} TRX from ${resource}`);
    await this.audit.record({ actor, action: 'pool.unstake', subjectType: 'pool', subjectId: address, details: { amountTrx, resource, txId }, ip });
    return { txId, explorerUrl: explorerTx(this.cfg.network, txId) };
  }

  private async requireConfigured(): Promise<string> {
    const address = await this.poolAddr.get();
    if (!address) throw new ConflictException('pool wallet not available yet: set up the wallet first');
    return address;
  }
}
