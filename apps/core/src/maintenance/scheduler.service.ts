import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CONFIG, type AppConfig } from '../config/config.js';
import { RedisLock } from '../infra/redis.js';
import { Queues, JOB } from '../infra/queues.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddressesService } from '../addresses/addresses.service.js';
import { SweepPlannerService } from '../sweeps/sweep-planner.service.js';
import { SweepLifecycleService } from '../sweeps/sweep-lifecycle.service.js';
import { BlockScannerService } from '../watcher/block-scanner.service.js';

/** Periodic housekeeping. Every task takes a short Redis lock so multiple API replicas do not double-run. */
@Injectable()
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly lock: RedisLock,
    private readonly queues: Queues,
    private readonly prisma: PrismaService,
    private readonly addresses: AddressesService,
    private readonly planner: SweepPlannerService,
    private readonly lifecycle: SweepLifecycleService,
    private readonly scanner: BlockScannerService,
  ) {}

  private guard(name: string, ttlMs: number, fn: () => Promise<void>): Promise<void> {
    if (!this.cfg.RUN_WORKERS) return Promise.resolve();
    return this.lock
      .withLock(`lock:sched:${name}:${this.cfg.network}`, ttlMs, fn)
      .then(() => undefined)
      .catch((e) => this.log.error(`${name}: ${(e as Error).message}`));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async warmAddressPool(): Promise<void> {
    await this.guard('warm-pool', 55_000, async () => {
      const n = await this.addresses.warmPool().catch((e) => {
        if ((e as Error).name === 'WalletNotInitializedError') return 0;
        throw e;
      });
      if (n > 0) this.log.log(`address pool: +${n}`);
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepDue(): Promise<void> {
    await this.guard('sweep-due', 4 * 60_000, async () => {
      const n = await this.planner.sweepAll('scheduler');
      if (n > 0) this.log.log(`sweep evaluation queued for ${n} addresses`);
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async watchdog(): Promise<void> {
    await this.guard('watchdog', 55_000, async () => {
      const st = await this.scanner.readStatus();
      if (!st.updatedAt) {
        // The Redis status key expires after 5 minutes: no key at all means the watcher has been silent even longer.
        if (st.cursorBlock !== null) this.log.error('watcher has not reported for more than 5 minutes (status key expired)');
      } else if (Date.now() - new Date(st.updatedAt).getTime() > 3 * 60_000) {
        this.log.error(`watcher has not reported for ${Math.round((Date.now() - new Date(st.updatedAt).getTime()) / 1000)} s`);
      }
    });
  }

  /** Failed sweeps with retryable causes get another attempt once per hour until SWEEP_MAX_ATTEMPTS. */
  @Cron(CronExpression.EVERY_HOUR)
  async retryFailed(): Promise<void> {
    await this.guard('retry-failed', 5 * 60_000, async () => {
      const rows = await this.prisma.sweep.findMany({
        where: {
          status: 'failed',
          attempt: { lt: this.cfg.SWEEP_MAX_ATTEMPTS },
          updatedAt: { lt: new Date(Date.now() - 60 * 60_000) },
          NOT: [{ lastError: { contains: 'POLICY' } }, { lastError: { contains: 'signer policy' } }, { lastError: { contains: 'REVERT' } }],
          depositAddress: { status: 'assigned', usdtBalanceCached: { gt: 0n } },
        },
        select: { id: true },
        take: 50,
      });
      for (const r of rows) await this.lifecycle.retry(r.id, 'scheduler').catch((e) => this.log.warn(`auto-retry ${r.id}: ${(e as Error).message}`));
      if (rows.length > 0) this.log.log(`auto-retried ${rows.length} failed sweeps`);
    });
  }

  @Cron('0 15 3 * * *')
  async reconcile(): Promise<void> {
    await this.guard('reconcile', 60_000, async () => {
      await this.queues.maintenance.add(JOB.reconcile, {}, { jobId: `reconcile-${new Date().toISOString().slice(0, 10)}` });
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async requeueUnprocessedEvents(): Promise<void> {
    await this.guard('requeue-events', 60_000, async () => {
      const n = await this.scanner.requeueUnprocessed();
      if (n > 0) this.log.warn(`re-enqueued ${n} unprocessed chain events`);
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireResourceOps(): Promise<void> {
    await this.guard('expire-ops', 60_000, async () => {
      await this.prisma.resourceOperation.updateMany({
        where: { status: 'delivered', expiresAt: { lt: new Date() }, provider: 'itrx' },
        data: { status: 'expired' },
      });
    });
  }
}
