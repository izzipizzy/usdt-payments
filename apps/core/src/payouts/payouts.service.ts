import { ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Payout, PayoutStatus, Prisma } from '@prisma/client';
import { ENERGY_TRANSFER_NONZERO_RECIPIENT, ENERGY_TRANSFER_ZERO_RECIPIENT, parseUsdt, type CreatePayoutRequest, type TronTxJson } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Queues } from '../infra/queues.js';
import { SettingsService } from '../settings/settings.service.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TxBuilderService } from '../tron/tx-builder.service.js';
import { SignerClient, SignerPolicyError } from '../signer/signer.client.js';
import { EnergyManagerService, type EnergyTarget } from '../energy/energy-manager.service.js';
import { AuditService } from '../common/audit.service.js';
import { LabelsService } from '../backup/labels.service.js';
import { NonRetryableError, RetryableError, errMessage, isRetryable } from '../common/errors.js';
import { paginated, parsePage, type PageQuery } from '../common/pagination.js';

const ACTIVE: PayoutStatus[] = ['planned', 'energy_pending', 'ready', 'signing', 'broadcast'];

/**
 * Outgoing USDT payments in two hops through a one-time address derived from the phrase
 * (account 3, index = payout id):
 *   stage 1: main → hop         (the main key can only ever sign transfers to its own hop addresses)
 *   stage 2: hop  → recipient
 * Each stage runs planned → energy_pending → ready → signing → broadcast and is confirmed on a solid receipt.
 */
@Injectable()
export class PayoutsService {
  private readonly log = new Logger(PayoutsService.name);
  private mainAddressCache: { value: string | null; at: number } = { value: null, at: 0 };

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly settings: SettingsService,
    private readonly node: TronNodeClient,
    private readonly txb: TxBuilderService,
    private readonly signer: SignerClient,
    private readonly energy: EnergyManagerService,
    private readonly audit: AuditService,
    private readonly labels: LabelsService,
  ) {}

  /** The main wallet address (account 2): payouts start here. */
  async payoutAddress(): Promise<string | null> {
    if (Date.now() - this.mainAddressCache.at < 30_000) return this.mainAddressCache.value;
    try {
      const st = await this.signer.walletStatus();
      this.mainAddressCache = { value: st.initialized ? st.mainAddress : null, at: Date.now() };
    } catch {
      this.mainAddressCache = { value: this.mainAddressCache.value, at: Date.now() - 20_000 };
    }
    return this.mainAddressCache.value;
  }

  invalidate(): void {
    this.mainAddressCache = { value: null, at: 0 };
  }

  // ------------------------------------------------------------ create / list

  /** Idempotent by externalId. Enforces per-transaction and daily limits from settings. */
  async create(req: CreatePayoutRequest, actor: string, ip?: string): Promise<{ payout: Payout; created: boolean }> {
    const existing = await this.prisma.payout.findUnique({ where: { externalId: req.externalId } });
    if (existing) return { payout: existing, created: false };

    const from = await this.payoutAddress();
    if (!from) throw new ConflictException('main wallet is not available: set up the wallet first');
    if (req.to === from) throw new UnprocessableEntityException('cannot pay out to the main wallet itself');
    const amount = parseUsdt(req.amount);
    if (amount <= 0n) throw new UnprocessableEntityException('amount must be positive');

    const settings = await this.settings.get();
    const maxPer = parseUsdt(settings.payoutMaxUsdt);
    if (maxPer > 0n && amount > maxPer) throw new UnprocessableEntityException(`amount exceeds the per-payout limit of ${settings.payoutMaxUsdt} USDT`);
    const dailyMax = parseUsdt(settings.payoutDailyMaxUsdt);
    const balance = await this.node.usdtBalanceOf(from);
    if (balance < amount) throw new UnprocessableEntityException(`main wallet holds ${balance} raw USDT, less than the requested amount`);

    try {
      // The daily-limit check and the insert run under one advisory lock, so concurrent requests cannot all
      // observe the same remaining allowance and collectively exceed it.
      const result = await this.prisma.$transaction(async (tx): Promise<{ payout: Payout; created: boolean }> => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payout-create'))`;
        // Same externalId racing with itself: the loser must get the winner's row, not a 422 from the daily limit.
        const dup = await tx.payout.findUnique({ where: { externalId: req.externalId } });
        if (dup) return { payout: dup, created: false };
        if (dailyMax > 0n) {
          const since = new Date(Date.now() - 24 * 3_600_000);
          const agg = await tx.payout.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: since }, status: { notIn: ['failed', 'cancelled'] } } });
          if ((agg._sum.amount ?? 0n) + amount > dailyMax) throw new UnprocessableEntityException(`daily payout limit of ${settings.payoutDailyMaxUsdt} USDT would be exceeded`);
        }
        const payout = await tx.payout.create({
          data: { externalId: req.externalId, fromAddress: from, toAddress: req.to, amount, note: req.note ?? null, status: 'planned', stage: 1, createdBy: actor },
        });
        return { payout, created: true };
      });
      if (!result.created) return result;
      const { payout } = result;
      await this.audit.record({ actor, action: 'payout.create', subjectType: 'payout', subjectId: payout.id, details: { to: req.to, amount: req.amount, externalId: req.externalId }, ip });
      await this.queues.enqueueRunPayout(payout.id, payout.attempt);
      this.labels.scheduleWrite();
      return { payout, created: true };
    } catch (e) {
      if (e instanceof UnprocessableEntityException) throw e;
      const again = await this.prisma.payout.findUnique({ where: { externalId: req.externalId } });
      if (again) return { payout: again, created: false };
      throw e;
    }
  }

  async get(id: bigint): Promise<Payout> {
    const p = await this.prisma.payout.findUnique({ where: { id } });
    if (!p) throw new NotFoundException(`payout ${id} not found`);
    return p;
  }

  async byExternalId(externalId: string): Promise<Payout> {
    const p = await this.prisma.payout.findUnique({ where: { externalId } });
    if (!p) throw new NotFoundException(`payout ${externalId} not found`);
    return p;
  }

  async list(q: PageQuery & { status?: string; to?: string }) {
    const page = parsePage(q, ['createdAt', 'updatedAt', 'amount', 'status']);
    const where: Prisma.PayoutWhereInput = {};
    if (q.status) where.status = q.status as PayoutStatus;
    if (q.to) where.toAddress = { contains: q.to };
    const [rows, total] = await Promise.all([
      this.prisma.payout.findMany({ where, orderBy: page.orderBy, skip: page.skip, take: page.take }),
      this.prisma.payout.count({ where }),
    ]);
    return paginated(rows, total, page);
  }

  // ------------------------------------------------------------ hop helpers

  /** Owner and recipient of the current stage. */
  private hop(p: Payout): { owner: string; recipient: string } {
    if (!p.viaAddress) throw new NonRetryableError('hop address missing', 'STATE');
    return p.stage === 1 ? { owner: p.fromAddress, recipient: p.viaAddress } : { owner: p.viaAddress, recipient: p.toAddress };
  }

  private target(p: Payout): EnergyTarget {
    return { payoutId: p.id, stage: p.stage, attempt: p.attempt };
  }

  private async transition(id: bigint, from: PayoutStatus | PayoutStatus[], to: PayoutStatus, data: Record<string, unknown> = {}): Promise<boolean> {
    const res = await this.prisma.payout.updateMany({ where: { id, status: Array.isArray(from) ? { in: from } : from }, data: { status: to, ...data } });
    return res.count === 1;
  }

  // ------------------------------------------------------------ pipeline

  async run(id: bigint): Promise<void> {
    try {
      for (let guard = 0; guard < 12; guard++) {
        let p = await this.get(id);
        if (!p.viaAddress) {
          const via = await this.signer.deriveTemp(Number(p.id));
          p = await this.prisma.payout.update({ where: { id }, data: { viaAddress: via.address } });
        }
        switch (p.status) {
          case 'planned':
          case 'energy_pending':
            await this.stepResources(p);
            break;
          case 'ready':
            await this.stepBuild(p);
            break;
          case 'signing':
            await this.stepSignAndBroadcast(p);
            break;
          case 'broadcast':
            await this.queues.enqueueConfirmPayout(p.id, 10_000);
            return;
          default:
            return;
        }
      }
      throw new RetryableError('payout did not settle within the step budget');
    } catch (e) {
      if (isRetryable(e)) throw e;
      await this.fail(id, errMessage(e), { retryable: false });
    }
  }

  private async stepResources(p: Payout): Promise<void> {
    const { owner, recipient } = this.hop(p);
    const [account, recipientBalance] = await Promise.all([this.node.getAccount(owner), this.node.usdtBalanceOf(recipient)]);
    const activate = account === null;
    await this.transition(p.id, ['planned', 'energy_pending'], 'energy_pending');
    const settings = await this.settings.get();
    let estimate = recipientBalance === 0n ? ENERGY_TRANSFER_ZERO_RECIPIENT : ENERGY_TRANSFER_NONZERO_RECIPIENT;
    const sim = await this.node.estimateTransferEnergy(owner, recipient, p.amount).catch(() => null);
    if (sim && !sim.ok && !activate) throw new NonRetryableError(`transfer simulation failed: ${sim.message ?? 'unknown'}`, 'REVERT');
    if (sim?.ok && sim.energy > 0) estimate = sim.energy;
    const energyNeeded = Math.ceil(estimate * settings.energyMargin);
    const result = await this.energy.ensureEnergy(this.target(p), owner, energyNeeded, activate);
    await this.energy.ensureBandwidth(this.target(p), owner);
    const cost = await this.prisma.resourceOperation.aggregate({ _sum: { costSun: true }, where: { payoutId: p.id, status: 'delivered' } });
    await this.transition(p.id, 'energy_pending', 'ready', { energySource: result.source, energyEstimated: energyNeeded, resourceCostSun: cost._sum.costSun ?? 0n });
  }

  private async stepBuild(p: Payout): Promise<void> {
    const { owner, recipient } = this.hop(p);
    const balance = await this.node.usdtBalanceOf(owner);
    if (balance < p.amount) throw new NonRetryableError(`stage ${p.stage}: ${owner} holds ${balance} raw USDT, below the payout amount`, 'INSUFFICIENT');
    const settings = await this.settings.get();
    const tx = await this.txb.usdtTransfer(owner, recipient, p.amount, BigInt(settings.feeLimitSun));
    const raw = tx.raw_data as { expiration: number };
    const ok = await this.transition(p.id, 'ready', 'signing', { txId: tx.txID, unsignedRaw: tx as object, signedRaw: null, expiration: new Date(raw.expiration) });
    if (!ok) throw new RetryableError('payout changed state during build');
  }

  private async stepSignAndBroadcast(p: Payout): Promise<void> {
    const unsigned = p.unsignedRaw as unknown as TronTxJson | null;
    if (!unsigned || !p.expiration) {
      await this.transition(p.id, 'signing', 'ready');
      return;
    }
    // Nothing is signed yet: rebuilding close to expiry is free and safe.
    const nearExpiry = p.expiration.getTime() < Date.now() + 30_000;
    // Something IS signed: it may already be in the network (crash after broadcast, node lag). Only treat it as dead
    // once the chain itself can no longer include it, and even then only after the head confirms it never landed.
    const hardExpired = Date.now() > p.expiration.getTime() + 60_000;
    let signed = p.signedRaw as unknown as TronTxJson | null;
    if (!signed) {
      if (nearExpiry) return this.rebuild(p, 'unsigned transaction expired');
      try {
        const res = await this.signer.signPayout(unsigned, p.stage === 1 ? 1 : 2, Number(p.id), `payout ${p.id} (${p.externalId})`);
        signed = { ...unsigned, signature: [res.signature] };
        await this.prisma.payout.update({ where: { id: p.id }, data: { signedRaw: signed as object } });
      } catch (e) {
        if (e instanceof SignerPolicyError) {
          this.log.error(`SECURITY: signer refused payout ${p.id} stage ${p.stage}: ${e.code} ${e.message}`);
          throw new NonRetryableError(`signer policy refused: ${e.code} ${e.message}`, 'POLICY');
        }
        throw new RetryableError(`signer error: ${errMessage(e)}`, 'SIGNER');
      }
    }
    if (hardExpired) {
      if (await this.node.getTransactionInfo(unsigned.txID)) return this.markBroadcast(p, unsigned.txID, 'already executed on head');
      return this.rebuild(p, 'signed transaction expired before broadcast');
    }
    // A still-valid signed tx is always (re)broadcast: DUP_TRANSACTION_ERROR counts as success, an expiration error rebuilds.
    const res = await this.node.broadcast(signed);
    if (res.ok) return this.markBroadcast(p, unsigned.txID, res.code);
    switch (res.code) {
      case 'TAPOS_ERROR':
      case 'TRANSACTION_EXPIRATION_ERROR':
        // The node may reject a tx it has already executed (old ref block / past expiry). Never rebuild one the head knows.
        if (await this.node.getTransactionInfo(unsigned.txID)) return this.markBroadcast(p, unsigned.txID, `${res.code} but executed on head`);
        return this.rebuild(p, `${res.code}`);
      case 'BANDWITH_ERROR':
      case 'BANDWIDTH_ERROR':
        await this.energy.ensureBandwidth(this.target(p), this.hop(p).owner);
        throw new RetryableError(`broadcast ${res.code}; bandwidth topped up`, 'BANDWIDTH');
      case 'SERVER_BUSY':
      case 'NO_CONNECTION':
        throw new RetryableError(`broadcast ${res.code}`, res.code);
      default:
        throw new NonRetryableError(`broadcast rejected: ${res.code} ${res.message ?? ''}`, res.code);
    }
  }

  /** The signed tx is in the network (broadcast accepted, duplicate, or seen on head): hand it to the confirm job as-is. */
  private async markBroadcast(p: Payout, txId: string, how: string): Promise<void> {
    const moved = await this.prisma.payout.updateMany({ where: { id: p.id, status: 'signing', txId }, data: { status: 'broadcast', broadcastAt: new Date() } });
    if (moved.count === 1) this.log.log(`payout ${p.id} stage ${p.stage} broadcast ${txId} (${how})`);
    await this.queues.enqueueConfirmPayout(p.id, 10_000);
  }

  private async rebuild(p: Payout, reason: string): Promise<void> {
    this.log.warn(`payout ${p.id} stage ${p.stage}: rebuilding transaction (${reason})`);
    await this.prisma.payout.update({ where: { id: p.id }, data: { status: 'ready', txId: null, expiration: null, lastError: reason } });
    await this.prisma.$executeRaw`UPDATE payouts SET unsigned_raw = NULL, signed_raw = NULL WHERE id = ${p.id}`;
  }

  /** Confirm job: solid receipt of the current stage's transaction. */
  async check(id: bigint): Promise<'confirmed' | 'failed' | 'pending'> {
    const p = await this.prisma.payout.findUnique({ where: { id } });
    if (!p || p.status !== 'broadcast' || !p.txId) return p?.status === 'confirmed' ? 'confirmed' : 'failed';
    const info = await this.node.getSolidTransactionInfo(p.txId);
    if (info) {
      const result = info.receipt?.result ?? (info.result === 'FAILED' ? 'FAILED' : 'SUCCESS');
      if (result === 'SUCCESS') {
        if (p.stage === 1) {
          // Funds are on the hop address: release stage-1 resources and start stage 2 with a clean tx slate.
          // The transition is fenced on stage + txId so a stale confirm job cannot regress a later state.
          const moved = await this.prisma.$transaction(async (tx) => {
            const res = await tx.payout.updateMany({
              where: { id, status: 'broadcast', stage: 1, txId: p.txId },
              data: { stage: 2, status: 'planned', hop1TxId: p.txId, hop1ConfirmedAt: new Date(), txId: null, expiration: null, broadcastAt: null, energyUsed: info.receipt?.energy_usage_total ?? 0 },
            });
            if (res.count === 1) await tx.$executeRaw`UPDATE payouts SET unsigned_raw = NULL, signed_raw = NULL WHERE id = ${id}`;
            return res.count === 1;
          });
          if (!moved) return 'pending';
          await this.energy.releaseAll({ payoutId: id });
          this.log.log(`payout ${id} hop 1 confirmed (${p.txId}); starting hop 2 → ${p.toAddress}`);
          await this.queues.enqueueRunPayout(id, p.attempt);
          return 'pending';
        }
        const done2 = await this.prisma.payout.updateMany({
          where: { id, status: 'broadcast', stage: 2, txId: p.txId },
          data: { status: 'confirmed', confirmedAt: new Date(), energyUsed: (p.energyUsed ?? 0) + (info.receipt?.energy_usage_total ?? 0), trxFeeBurnedSun: BigInt(info.fee ?? 0) },
        });
        if (done2.count !== 1) return 'pending';
        await this.energy.releaseAll({ payoutId: id });
        this.log.log(`payout ${id} confirmed: ${p.amount} raw USDT → ${p.toAddress} via ${p.viaAddress}`);
        return 'confirmed';
      }
      const detail = info.resMessage ? Buffer.from(info.resMessage, 'hex').toString('utf8') : '';
      await this.fail(id, `stage ${p.stage} on-chain ${result}${detail ? `: ${detail}` : ''}`, { retryable: result === 'OUT_OF_ENERGY' });
      return 'failed';
    }
    const now = Date.now();
    if (p.expiration && now > p.expiration.getTime() + 60_000 && !(await this.node.getTransactionInfo(p.txId))) {
      await this.fail(id, `stage ${p.stage}: transaction expired without inclusion`, { retryable: true });
      return 'failed';
    }
    if (p.broadcastAt && now - p.broadcastAt.getTime() > this.cfg.CONFIRM_TIMEOUT_MS) {
      // A timeout alone is not proof of non-inclusion: if the head already executed it, keep waiting for solidity
      // instead of failing and letting a retry pay the same hop twice.
      if (await this.node.getTransactionInfo(p.txId)) {
        this.log.warn(`payout ${id} stage ${p.stage}: ${p.txId} is executed on head but not solid after the confirmation timeout; still waiting`);
      } else {
        await this.fail(id, `stage ${p.stage}: no solid receipt within the confirmation timeout`, { retryable: true });
        return 'failed';
      }
    }
    await this.queues.enqueueConfirmPayout(id, 10_000);
    return 'pending';
  }

  /** Mark failed (stage is kept so a retry resumes where the funds are), release resources. */
  async fail(id: bigint, reason: string, opts: { retryable: boolean }): Promise<void> {
    const p = await this.prisma.payout.findUnique({ where: { id } });
    if (!p || !ACTIVE.includes(p.status)) return;
    await this.prisma.payout.updateMany({ where: { id, status: { in: ACTIVE } }, data: { status: 'failed', lastError: reason.slice(0, 2000) } });
    await this.energy.releaseAll({ payoutId: id }).catch(() => undefined);
    this.log.error(`payout ${id} failed at stage ${p.stage} (${opts.retryable ? 'retryable' : 'final'}): ${reason}`);
    if (opts.retryable && p.attempt + 1 < this.cfg.SWEEP_MAX_ATTEMPTS) await this.retry(id, 'system', 10 * 60_000);
  }

  /** failed → planned with attempt+1; the stage is preserved (a hop already funded is not repeated). */
  async retry(id: bigint, actor: string, delayMs = 0, ip?: string): Promise<Payout> {
    const p = await this.get(id);
    if (p.status !== 'failed') throw new ConflictException(`payout ${id} is ${p.status}; only failed payouts can be retried`);
    const updated = await this.prisma.payout.update({
      where: { id },
      data: { status: 'planned', attempt: { increment: 1 }, txId: null, expiration: null, broadcastAt: null },
    });
    await this.prisma.$executeRaw`UPDATE payouts SET unsigned_raw = NULL, signed_raw = NULL WHERE id = ${id}`;
    await this.audit.record({ actor, action: 'payout.retry', subjectType: 'payout', subjectId: id, details: { attempt: updated.attempt, stage: p.stage }, ip });
    await this.queues.enqueueRunPayout(id, updated.attempt, delayMs);
    return updated;
  }

  /** Cancel only while nothing has left the main wallet (stage 1, not yet broadcast). */
  async cancel(id: bigint, actor: string, reason?: string, ip?: string): Promise<Payout> {
    const p = await this.get(id);
    if (p.status === 'confirmed' || p.status === 'cancelled') throw new ConflictException(`payout is already ${p.status}`);
    if (p.stage !== 1 || p.status === 'broadcast') {
      throw new ConflictException('funds have already left the main wallet (hop 1 broadcast); use retry to finish the payout instead of cancelling');
    }
    if (p.status === 'signing') {
      throw new ConflictException('a worker is signing/broadcasting this payout right now; wait for it to reach broadcast or failed, then decide');
    }
    // Conditional update: if a worker moved the row to signing/broadcast in the meantime, do not cancel under its feet.
    const res = await this.prisma.payout.updateMany({
      where: { id, stage: 1, status: { in: ['planned', 'energy_pending', 'ready', 'failed'] } },
      data: { status: 'cancelled', lastError: reason ?? 'cancelled by operator' },
    });
    if (res.count !== 1) throw new ConflictException('payout changed state while cancelling; reload and try again');
    await this.energy.releaseAll({ payoutId: id }).catch(() => undefined);
    await this.audit.record({ actor, action: 'payout.cancel', subjectType: 'payout', subjectId: id, details: { reason }, ip });
    return this.get(id);
  }

  async resume(): Promise<number> {
    const rows = await this.prisma.payout.findMany({ where: { status: { in: ACTIVE } }, select: { id: true, status: true, attempt: true } });
    for (const r of rows) {
      if (r.status === 'broadcast') await this.queues.enqueueConfirmPayout(r.id, 5_000);
      else await this.queues.enqueueRunPayout(r.id, r.attempt, 5_000);
    }
    return rows.length;
  }
}
