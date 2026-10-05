import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Sweep } from '@prisma/client';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Queues } from '../infra/queues.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { EnergyManagerService } from '../energy/energy-manager.service.js';
import { AuditService } from '../common/audit.service.js';
import { CollectorService } from '../signer/signer.client.js';

const ACTIVE = ['planned', 'activating', 'energy_pending', 'ready', 'signing', 'broadcast'] as const;

/** Terminal transitions and operator actions: confirm, fail, retry, cancel, rebuild. */
@Injectable()
export class SweepLifecycleService {
  private readonly log = new Logger(SweepLifecycleService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly node: TronNodeClient,
    private readonly energy: EnergyManagerService,
    private readonly audit: AuditService,
    private readonly collector: CollectorService,
  ) {}

  async get(sweepId: bigint): Promise<Sweep> {
    const s = await this.prisma.sweep.findUnique({ where: { id: sweepId } });
    if (!s) throw new NotFoundException(`sweep ${sweepId} not found`);
    return s;
  }

  /** Called by the confirm job once the receipt is in a solid block. */
  async confirm(sweepId: bigint, receipt: { energyUsed: number; bandwidthUsed: number; feeSun: bigint }): Promise<void> {
    const sweep = await this.prisma.sweep.findUnique({ where: { id: sweepId }, include: { depositAddress: true, sweepDeposits: { include: { deposit: true } } } });
    if (!sweep || sweep.status !== 'broadcast') return;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.sweep.updateMany({
        where: { id: sweepId, status: 'broadcast' },
        data: { status: 'confirmed', confirmedAt: now, energyUsed: receipt.energyUsed, bandwidthUsed: receipt.bandwidthUsed, trxFeeBurnedSun: receipt.feeSun },
      });
      if (moved.count !== 1) return;
      await tx.deposit.updateMany({ where: { sweepId, status: 'sweeping' }, data: { status: 'swept', sweptAt: now } });
      const remaining = await tx.deposit.findFirst({
        where: { depositAddressId: sweep.depositAddressId, status: { in: ['confirmed', 'credited'] }, sweepId: null },
        orderBy: { confirmedAt: 'asc' },
      });
      await tx.depositAddress.update({
        where: { id: sweep.depositAddressId },
        data: { lastSweepAt: now, oldestUnsweptAt: remaining?.confirmedAt ?? null, onchainStatus: 'activated' },
      });
    });
    try {
      const balance = await this.node.usdtBalanceOf(sweep.depositAddress.address);
      await this.prisma.depositAddress.update({ where: { id: sweep.depositAddressId }, data: { usdtBalanceCached: balance, balanceCheckedAt: new Date() } });
    } catch (e) {
      this.log.warn(`post-sweep balance refresh failed: ${(e as Error).message}`);
    }
    await this.energy.releaseAll(sweepId);
    this.log.log(`sweep ${sweepId} confirmed: ${sweep.amount} raw USDT → ${sweep.collectorAddress}, energy ${receipt.energyUsed}, fee ${receipt.feeSun} sun`);
  }

  /** Mark failed, detach deposits, release resources. */
  async fail(sweepId: bigint, reason: string, opts: { retryable: boolean }): Promise<void> {
    const sweep = await this.prisma.sweep.findUnique({ where: { id: sweepId } });
    if (!sweep || !(ACTIVE as readonly string[]).includes(sweep.status)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.sweep.updateMany({ where: { id: sweepId, status: { in: [...ACTIVE] } }, data: { status: 'failed', lastError: reason.slice(0, 2000) } });
      await tx.deposit.updateMany({ where: { sweepId, status: 'sweeping', creditedAt: { not: null } }, data: { status: 'credited', sweepId: null } });
      await tx.deposit.updateMany({ where: { sweepId, status: 'sweeping' }, data: { status: 'confirmed', sweepId: null } });
      await tx.sweepDeposit.deleteMany({ where: { sweepId } });
    });
    await this.energy.releaseAll(sweepId).catch(() => undefined);
    this.log.error(`sweep ${sweepId} failed (${opts.retryable ? 'retryable' : 'final'}): ${reason}`);
    if (opts.retryable && sweep.attempt + 1 < this.cfg.SWEEP_MAX_ATTEMPTS) {
      await this.retry(sweepId, 'system', 15 * 60_000);
    }
  }

  /** failed → planned with attempt+1. */
  async retry(sweepId: bigint, actor: string, delayMs = 0): Promise<Sweep> {
    const sweep = await this.get(sweepId);
    if (sweep.status !== 'failed') throw new ConflictException(`sweep ${sweepId} is ${sweep.status}, only failed sweeps can be retried`);
    const address = await this.prisma.depositAddress.findUnique({ where: { id: sweep.depositAddressId } });
    if (!address || address.status !== 'assigned') throw new ConflictException('address is not in assigned state');
    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.sweep.update({
        where: { id: sweepId },
        data: { status: 'planned', attempt: { increment: 1 }, txId: null, refBlockBytes: null, refBlockHash: null, expiration: null, broadcastAt: null },
      });
      await tx.$executeRaw`UPDATE sweeps SET unsigned_raw = NULL, signed_raw = NULL WHERE id = ${sweepId}`;
      const deposits = await tx.deposit.findMany({ where: { depositAddressId: sweep.depositAddressId, sweepId: null, status: { in: ['confirmed', 'credited'] } }, select: { id: true } });
      if (deposits.length > 0) {
        await tx.sweepDeposit.createMany({ data: deposits.map((d) => ({ sweepId, depositId: d.id })), skipDuplicates: true });
        await tx.deposit.updateMany({ where: { id: { in: deposits.map((d) => d.id) } }, data: { sweepId, status: 'sweeping' } });
      }
      return s;
    });
    await this.audit.record({ actor, action: 'sweep.retry', subjectType: 'sweep', subjectId: sweepId, details: { attempt: updated.attempt } });
    await this.queues.enqueueRunSweep(sweepId, updated.attempt, delayMs);
    return updated;
  }

  async cancel(sweepId: bigint, actor: string, reason?: string, ip?: string): Promise<Sweep> {
    const sweep = await this.get(sweepId);
    if (sweep.status === 'broadcast') throw new ConflictException('already broadcast; wait for confirmation or use rebuild once it expired');
    if (sweep.status === 'signing') throw new ConflictException('a worker is signing/broadcasting this sweep right now; wait for broadcast or failed');
    if (!(ACTIVE as readonly string[]).includes(sweep.status) && sweep.status !== 'failed') throw new ConflictException(`cannot cancel a ${sweep.status} sweep`);
    await this.prisma.$transaction(async (tx) => {
      // Conditional: a worker may have moved the row to signing/broadcast since we read it. Then nothing is detached.
      const moved = await tx.sweep.updateMany({
        where: { id: sweepId, status: { in: ['planned', 'activating', 'energy_pending', 'ready', 'failed'] } },
        data: { status: 'abandoned', lastError: reason ?? 'cancelled by operator' },
      });
      if (moved.count !== 1) throw new ConflictException('sweep changed state while cancelling (a worker is signing or broadcasting it); reload and try again');
      await tx.deposit.updateMany({ where: { sweepId, status: 'sweeping', creditedAt: { not: null } }, data: { status: 'credited', sweepId: null } });
      await tx.deposit.updateMany({ where: { sweepId, status: 'sweeping' }, data: { status: 'confirmed', sweepId: null } });
      await tx.sweepDeposit.deleteMany({ where: { sweepId } });
    });
    await this.energy.releaseAll(sweepId).catch(() => undefined);
    await this.audit.record({ actor, action: 'sweep.cancel', subjectType: 'sweep', subjectId: sweepId, details: { reason }, ip });
    return this.get(sweepId);
  }

  /** Supersede a failed or stuck sweep with a fresh one. */
  async rebuild(sweepId: bigint, actor: string, ip?: string): Promise<Sweep> {
    const sweep = await this.get(sweepId);
    if (sweep.status === 'broadcast') {
      if (!sweep.expiration || sweep.expiration.getTime() > Date.now()) throw new ConflictException('transaction has not expired yet');
      const info = sweep.txId ? await this.node.getSolidTransactionInfo(sweep.txId) : null;
      if (info) throw new ConflictException('transaction was actually included; let the confirm job finish');
      await this.prisma.sweep.update({ where: { id: sweepId }, data: { status: 'failed', lastError: 'expired without inclusion (rebuild)' } });
    } else if (sweep.status !== 'failed') {
      throw new ConflictException(`only failed or expired-broadcast sweeps can be rebuilt (status ${sweep.status})`);
    }
    const address = await this.prisma.depositAddress.findUnique({ where: { id: sweep.depositAddressId } });
    if (!address) throw new NotFoundException('address not found');
    const balance = await this.node.usdtBalanceOf(address.address);
    if (balance <= 0n) throw new ConflictException('address balance is zero');
    const collectorAddress = await this.collector.require();
    const fresh = await this.prisma.$transaction(async (tx) => {
      await tx.deposit.updateMany({ where: { sweepId, status: 'sweeping' }, data: { status: 'credited', sweepId: null } });
      await tx.sweepDeposit.deleteMany({ where: { sweepId } });
      const created = await tx.sweep.create({
        data: { depositAddressId: address.id, collectorAddress, amount: balance, status: 'planned', forced: sweep.forced },
      });
      await tx.sweep.update({ where: { id: sweepId }, data: { status: 'superseded', supersededById: created.id } });
      const deposits = await tx.deposit.findMany({ where: { depositAddressId: address.id, sweepId: null, status: { in: ['confirmed', 'credited'] } }, select: { id: true } });
      if (deposits.length > 0) {
        await tx.sweepDeposit.createMany({ data: deposits.map((d) => ({ sweepId: created.id, depositId: d.id })) });
        await tx.deposit.updateMany({ where: { id: { in: deposits.map((d) => d.id) } }, data: { sweepId: created.id, status: 'sweeping' } });
      }
      return created;
    });
    await this.energy.releaseAll(sweepId).catch(() => undefined);
    await this.audit.record({ actor, action: 'sweep.rebuild', subjectType: 'sweep', subjectId: sweepId, details: { newSweepId: fresh.id.toString() }, ip });
    await this.queues.enqueueRunSweep(fresh.id, fresh.attempt);
    return fresh;
  }

  /** On worker start: re-enqueue anything left mid-flight. */
  async resume(): Promise<number> {
    const rows = await this.prisma.sweep.findMany({ where: { status: { in: [...ACTIVE] } }, select: { id: true, status: true, attempt: true } });
    for (const s of rows) {
      if (s.status === 'broadcast') await this.queues.enqueueConfirmSweep(s.id, 5_000);
      else await this.queues.enqueueRunSweep(s.id, s.attempt, 5_000);
    }
    if (rows.length > 0) this.log.log(`resumed ${rows.length} in-flight sweeps`);
    return rows.length;
  }
}
