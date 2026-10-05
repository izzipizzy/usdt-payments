import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResourceOperation } from '@prisma/client';
import { BANDWIDTH_TRANSFER_BYTES, type ProviderDto } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SignerClient } from '../signer/signer.client.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TxBuilderService } from '../tron/tx-builder.service.js';
import { NonRetryableError, RetryableError, errMessage, sleep } from '../common/errors.js';
import { ProviderError, type EnergyProvider } from './energy-provider.js';
import { ItrxProvider } from './itrx.provider.js';
import { OwnPoolProvider } from './own-pool.provider.js';
import { BurnProvider } from './burn.provider.js';
import { PoolAddressService } from './pool-address.service.js';

/** What the resources are for: a sweep or a payout. Drives idempotency keys and bookkeeping. */
export interface EnergyTarget {
  sweepId?: bigint;
  payoutId?: bigint;
  /** Payout hop (1 or 2); part of the idempotency key. */
  stage?: number;
  attempt: number;
}

const targetKey = (t: EnergyTarget): string => (t.sweepId !== undefined ? `${t.sweepId}` : `p${t.payoutId}${t.stage ? `s${t.stage}` : ''}`);

export interface EnsureResult {
  source: 'rental' | 'own_pool' | 'burn';
  provider: string;
  costSun: bigint;
  activated: boolean;
}

/**
 * Gets energy (and activation, and bandwidth) onto a deposit address before a sweep,
 * trying providers in the configured order and verifying the result on-chain.
 */
@Injectable()
export class EnergyManagerService {
  private readonly log = new Logger(EnergyManagerService.name);
  private readonly providers: EnergyProvider[];

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly node: TronNodeClient,
    private readonly signer: SignerClient,
    private readonly txb: TxBuilderService,
    private readonly poolAddr: PoolAddressService,
    itrx: ItrxProvider,
    ownPool: OwnPoolProvider,
    burn: BurnProvider,
  ) {
    this.providers = [itrx, ownPool, burn];
  }

  async orderedProviders(): Promise<EnergyProvider[]> {
    const order = (await this.settings.get()).providerOrder;
    const out: EnergyProvider[] = [];
    for (const name of order) {
      const p = this.providers.find((x) => x.name === name);
      if (p && (await p.enabled())) out.push(p);
    }
    return out;
  }

  provider(name: string): EnergyProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  async providersStatus(): Promise<ProviderDto[]> {
    const out: ProviderDto[] = [];
    for (const p of this.providers) {
      const enabled = await p.enabled();
      const h = enabled ? await p.health() : { healthy: false, balanceSun: null, detail: 'disabled' };
      out.push({ name: p.name, enabled, healthy: h.healthy, balanceSun: h.balanceSun === null ? null : h.balanceSun.toString(), detail: h.detail });
    }
    return out;
  }

  async spentTodaySun(): Promise<bigint> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.resourceOperation.aggregate({
      _sum: { costSun: true },
      where: { createdAt: { gte: since }, status: { in: ['requested', 'delivered'] } },
    });
    return agg._sum.costSun ?? 0n;
  }

  /** Ensure `energyNeeded` energy is available on the address (activating it first if required). */
  async ensureEnergy(target: EnergyTarget, address: string, energyNeeded: number, activate: boolean): Promise<EnsureResult> {
    const settings = await this.settings.get();
    const budget = BigInt(settings.energyDailyBudgetSun);
    const spent = await this.spentTodaySun();
    if (budget > 0n && spent >= budget) {
      throw new RetryableError(`daily energy budget exhausted (${spent} / ${budget} sun)`, 'BUDGET');
    }

    // Already there? (e.g. re-run after a crash, or a rental still active)
    const current = await this.node.getAccountResource(address);
    const activatedNow = !activate || (await this.node.getAccount(address)) !== null;
    if (activatedNow && current.energyAvailable >= energyNeeded) {
      const prior = await this.prisma.resourceOperation.findFirst({ where: { sweepId: target.sweepId, payoutId: target.payoutId, status: 'delivered' }, orderBy: { createdAt: 'desc' } });
      return { source: sourceOf(prior?.provider), provider: prior?.provider ?? 'existing', costSun: prior?.costSun ?? 0n, activated: activatedNow };
    }

    const providers = await this.orderedProviders();
    if (providers.length === 0) throw new NonRetryableError('no energy provider is enabled', 'NO_PROVIDER');

    const errors: string[] = [];
    for (const p of providers) {
      const key = `${targetKey(target)}:${p.name}:${target.attempt}`;
      let op = await this.prisma.resourceOperation.findUnique({ where: { idempotencyKey: key } });
      if (op && op.status === 'failed') {
        errors.push(`${p.name}: previously failed (${op.lastError})`);
        continue;
      }
      if (!op) {
        op = await this.prisma.resourceOperation.create({
          data: {
            sweepId: target.sweepId,
            payoutId: target.payoutId,
            targetAddress: address,
            kind: 'rent_energy',
            provider: p.name,
            idempotencyKey: key,
            energyAmount: energyNeeded,
            status: 'requested',
          },
        });
        try {
          const res = await p.provide({ sweepId: target.sweepId ?? target.payoutId ?? 0n, address, energy: energyNeeded, activate, idempotencyKey: key });
          op = await this.prisma.resourceOperation.update({
            where: { id: op.id },
            data: {
              externalOrderId: res.externalId,
              costSun: res.costSun,
              expiresAt: res.expiresAt,
              txId: res.txId,
              providerPayload: (res.payload ?? {}) as object,
              kind: p.name === 'own_pool' ? 'delegate_energy' : p.name === 'burn' ? 'send_trx' : 'rent_energy',
            },
          });
        } catch (e) {
          const msg = errMessage(e);
          this.log.warn(`provider ${p.name} failed for ${targetKey(target)}: ${msg}`);
          await this.prisma.resourceOperation.update({ where: { id: op.id }, data: { status: 'failed', lastError: msg } });
          errors.push(`${p.name}: ${msg}`);
          if (e instanceof ProviderError && e.permanent) continue;
          continue;
        }
      }

      // Verify on-chain.
      const ok = await this.waitForResources(address, energyNeeded, activate);
      if (ok) {
        await this.prisma.resourceOperation.update({ where: { id: op.id }, data: { status: 'delivered' } });
        return { source: sourceOf(p.name), provider: p.name, costSun: op.costSun ?? 0n, activated: true };
      }
      const msg = `resources not visible on-chain within ${this.cfg.ENERGY_WAIT_MS} ms`;
      await this.prisma.resourceOperation.update({ where: { id: op.id }, data: { status: 'failed', lastError: msg } });
      await p.release(op).catch(() => undefined);
      errors.push(`${p.name}: ${msg}`);
    }
    throw new RetryableError(`all energy providers failed: ${errors.join(' | ')}`, 'ENERGY');
  }

  private async waitForResources(address: string, energyNeeded: number, needActivation: boolean): Promise<boolean> {
    const deadline = Date.now() + this.cfg.ENERGY_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await this.node.getAccountResource(address);
        const activated = !needActivation || (await this.node.getAccount(address)) !== null;
        if (activated && res.energyAvailable >= energyNeeded) return true;
      } catch (e) {
        this.log.warn(`resource poll failed: ${(e as Error).message}`);
      }
      await sleep(5_000);
    }
    return false;
  }

  /** Free bandwidth covers one transfer per day; top up from the pool when it is used up. */
  async ensureBandwidth(target: EnergyTarget, address: string): Promise<void> {
    const res = await this.node.getAccountResource(address);
    if (res.bandwidthAvailable >= BANDWIDTH_TRANSFER_BYTES) return;
    const acc = await this.node.getAccount(address);
    // Scoped to the current owner: a top-up for hop 1 (main wallet) says nothing about hop 2 (the hop address).
    const p = await this.prisma.resourceOperation.findFirst({ where: { sweepId: target.sweepId, payoutId: target.payoutId, targetAddress: address, kind: 'send_trx', status: 'delivered' } });
    const needSun = BigInt(BANDWIDTH_TRANSFER_BYTES) * 1000n;
    if (acc && acc.balanceSun >= needSun) return; // TRX on the address will be burned for bandwidth
    if (p) return;
    const poolAddress = await this.poolAddr.get();
    if (!poolAddress) {
      throw new RetryableError('address has no free bandwidth left today and no pool wallet is configured for a top-up', 'BANDWIDTH');
    }
    const key = `${targetKey(target)}:bandwidth:${target.attempt}`;
    const existing = await this.prisma.resourceOperation.findUnique({ where: { idempotencyKey: key } });
    if (existing?.status === 'delivered') return;
    const op =
      existing ??
      (await this.prisma.resourceOperation.create({
        data: { sweepId: target.sweepId, payoutId: target.payoutId, targetAddress: address, kind: 'send_trx', provider: 'own_pool', idempotencyKey: key, bandwidthAmount: BANDWIDTH_TRANSFER_BYTES, status: 'requested' },
      }));
    const tx = await this.txb.trxTransfer(poolAddress, address, this.cfg.POOL_BANDWIDTH_TOPUP_SUN);
    const { signature } = await this.signer.signPool(tx, `bandwidth top-up ${address}`);
    const bc = await this.node.broadcast({ ...tx, signature: [signature] });
    if (!bc.ok) {
      await this.prisma.resourceOperation.update({ where: { id: op.id }, data: { status: 'failed', lastError: bc.code } });
      throw new RetryableError(`bandwidth top-up broadcast failed: ${bc.code}`, 'BANDWIDTH');
    }
    await this.prisma.resourceOperation.update({
      where: { id: op.id },
      data: { status: 'delivered', txId: tx.txID, costSun: this.cfg.POOL_BANDWIDTH_TOPUP_SUN, externalOrderId: tx.txID },
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !(await this.node.getTransactionInfo(tx.txID))) await sleep(3_000);
  }

  /** Release everything a sweep or payout still holds (undelegate / reclaim). */
  async releaseAll(target: bigint | { payoutId: bigint }): Promise<void> {
    const where = typeof target === 'bigint' ? { sweepId: target } : { payoutId: target.payoutId };
    const ops = await this.prisma.resourceOperation.findMany({ where: { ...where, status: 'delivered' } });
    for (const op of ops) await this.releaseOp(op);
  }

  async releaseOp(op: ResourceOperation): Promise<void> {
    const p = this.provider(op.provider);
    if (!p) return;
    if (op.kind === 'send_trx' || op.kind === 'activate') return;
    await p.release(op);
    await this.prisma.resourceOperation.update({ where: { id: op.id }, data: { status: op.provider === 'own_pool' ? 'reclaimed' : 'expired' } }).catch(() => undefined);
  }
}

function sourceOf(provider: string | undefined | null): 'rental' | 'own_pool' | 'burn' {
  if (provider === 'own_pool') return 'own_pool';
  if (provider === 'burn') return 'burn';
  return 'rental';
}
