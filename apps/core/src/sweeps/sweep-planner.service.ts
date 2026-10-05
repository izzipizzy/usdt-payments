import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type DepositAddress, type Sweep } from '@prisma/client';
import { parseUsdt } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Queues } from '../infra/queues.js';
import { SettingsService } from '../settings/settings.service.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { AuditService } from '../common/audit.service.js';
import { CollectorService } from '../signer/signer.client.js';

export interface EvaluateResult {
  planned: boolean;
  sweepId?: bigint;
  reason: string;
  balance: bigint;
}

/** Decides whether an address should be swept now and creates the sweep row. */
@Injectable()
export class SweepPlannerService {
  private readonly log = new Logger(SweepPlannerService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly settings: SettingsService,
    private readonly node: TronNodeClient,
    private readonly audit: AuditService,
    private readonly collector: CollectorService,
  ) {}

  async evaluate(addressId: bigint, opts: { force?: boolean; actor?: string } = {}): Promise<EvaluateResult> {
    const address = await this.prisma.depositAddress.findUnique({ where: { id: addressId } });
    if (!address) return { planned: false, reason: 'address not found', balance: 0n };
    if (address.status === 'suspended' || address.status === 'retired') return { planned: false, reason: `address ${address.status}`, balance: address.usdtBalanceCached };

    const active = await this.prisma.sweep.findFirst({ where: { depositAddressId: addressId, status: { in: ['planned', 'activating', 'energy_pending', 'ready', 'signing', 'broadcast'] } } });
    if (active) return { planned: false, sweepId: active.id, reason: `sweep ${active.id} already active (${active.status})`, balance: address.usdtBalanceCached };

    const balance = await this.node.usdtBalanceOf(address.address);
    await this.prisma.depositAddress.update({ where: { id: addressId }, data: { usdtBalanceCached: balance, balanceCheckedAt: new Date() } });
    if (balance <= 0n) return { planned: false, reason: 'zero balance', balance };

    const settings = await this.settings.get();
    const minAmount = parseUsdt(settings.sweepMinUsdt);
    const maxAge = settings.sweepMaxAgeHours * 3_600_000;
    const tooOld = address.oldestUnsweptAt !== null && Date.now() - address.oldestUnsweptAt.getTime() > maxAge;
    if (!opts.force && balance < minAmount && !tooOld) {
      return { planned: false, reason: `below threshold (${balance} < ${minAmount}) and not older than ${settings.sweepMaxAgeHours} h`, balance };
    }
    if (settings.leaveDustOnAddress && balance <= 1n) return { planned: false, reason: 'only dust left', balance };

    if (settings.sweepMaxPerHour > 0) {
      const recent = await this.prisma.sweep.count({ where: { createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
      if (recent >= settings.sweepMaxPerHour) {
        this.log.warn(`sweep rate limit reached (${recent}/${settings.sweepMaxPerHour} per hour); deferring ${address.address}`);
        await this.queues.enqueueEvaluateSweep(addressId, { delayMs: 15 * 60_000 });
        return { planned: false, reason: 'rate limited', balance };
      }
    }

    const amount = settings.leaveDustOnAddress ? balance - 1n : balance;
    try {
      const sweep = await this.createSweep(address, amount, Boolean(opts.force));
      await this.audit.record({ actor: opts.actor ?? 'system', action: 'sweep.plan', subjectType: 'sweep', subjectId: sweep.id, details: { address: address.address, amount: amount.toString(), force: opts.force ?? false } });
      await this.queues.enqueueRunSweep(sweep.id, sweep.attempt);
      return { planned: true, sweepId: sweep.id, reason: 'planned', balance };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { planned: false, reason: 'another sweep became active concurrently', balance };
      }
      throw e;
    }
  }

  async createSweep(address: DepositAddress, amount: bigint, forced: boolean): Promise<Sweep> {
    const collectorAddress = await this.collector.require();
    return this.prisma.$transaction(async (tx) => {
      const sweep = await tx.sweep.create({
        data: { depositAddressId: address.id, collectorAddress, amount, status: 'planned', forced },
      });
      const deposits = await tx.deposit.findMany({ where: { depositAddressId: address.id, sweepId: null, status: { in: ['confirmed', 'credited'] } }, select: { id: true } });
      if (deposits.length > 0) {
        await tx.sweepDeposit.createMany({ data: deposits.map((d) => ({ sweepId: sweep.id, depositId: d.id })) });
        await tx.deposit.updateMany({ where: { id: { in: deposits.map((d) => d.id) } }, data: { sweepId: sweep.id, status: 'sweeping' } });
      }
      return sweep;
    });
  }

  /** Force a sweep from the admin UI. */
  async forceSweep(addressId: bigint, actor: string): Promise<bigint> {
    const res = await this.evaluate(addressId, { force: true, actor });
    if (!res.planned) throw new ConflictException(res.reason);
    return res.sweepId!;
  }

  /** Enqueue evaluation for every address that looks sweepable by the cached balance / age. */
  async sweepAll(actor: string): Promise<number> {
    const settings = await this.settings.get();
    const minAmount = parseUsdt(settings.sweepMinUsdt);
    const ageCutoff = new Date(Date.now() - settings.sweepMaxAgeHours * 3_600_000);
    const rows = await this.prisma.depositAddress.findMany({
      where: {
        status: 'assigned',
        OR: [{ usdtBalanceCached: { gte: minAmount } }, { AND: [{ usdtBalanceCached: { gt: 0n } }, { oldestUnsweptAt: { lte: ageCutoff } }] }],
        sweeps: { none: { status: { in: ['planned', 'activating', 'energy_pending', 'ready', 'signing', 'broadcast'] } } },
      },
      select: { id: true },
    });
    for (const r of rows) await this.queues.enqueueEvaluateSweep(r.id, { actor });
    return rows.length;
  }
}
