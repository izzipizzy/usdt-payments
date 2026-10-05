import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';
import { REDIS } from '../infra/redis.js';
import { JOB, QUEUE } from '../infra/queues.js';
import { DepositsService } from '../deposits/deposits.service.js';
import { SweepPlannerService } from '../sweeps/sweep-planner.service.js';
import { SweepRunnerService } from '../sweeps/sweep-runner.service.js';
import { SweepConfirmService } from '../sweeps/sweep-confirm.service.js';
import { SweepLifecycleService } from '../sweeps/sweep-lifecycle.service.js';
import { AddressesService } from '../addresses/addresses.service.js';
import { ReconciliationService } from '../maintenance/reconciliation.service.js';
import { PayoutsService } from '../payouts/payouts.service.js';
import { RecoveryService } from '../maintenance/recovery.service.js';
import { errMessage } from '../common/errors.js';

/** BullMQ workers for all queues. Started explicitly by the process that should run them. */
@Injectable()
export class WorkersService implements OnModuleDestroy {
  private readonly log = new Logger(WorkersService.name);
  private workers: Worker[] = [];

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly deposits: DepositsService,
    private readonly planner: SweepPlannerService,
    private readonly runner: SweepRunnerService,
    private readonly confirm: SweepConfirmService,
    private readonly lifecycle: SweepLifecycleService,
    private readonly addresses: AddressesService,
    private readonly reconciliation: ReconciliationService,
    private readonly payouts: PayoutsService,
    private readonly recovery: RecoveryService,
  ) {}

  async start(): Promise<void> {
    const connection = this.redis;
    const depositsWorker = new Worker(
      QUEUE.deposits,
      async (job: Job) => {
        if (job.name === JOB.processDeposit) await this.deposits.processChainEvent(BigInt(job.data.chainEventId));
      },
      { connection, concurrency: 4 },
    );

    const sweepsWorker = new Worker(
      QUEUE.sweeps,
      async (job: Job) => {
        switch (job.name) {
          case JOB.evaluateSweep: {
            const res = await this.planner.evaluate(BigInt(job.data.addressId), { force: job.data.force, actor: job.data.actor });
            if (!res.planned) this.log.debug(`evaluate ${job.data.addressId}: ${res.reason}`);
            return res.reason;
          }
          case JOB.runSweep:
            await this.runner.run(BigInt(job.data.sweepId));
            return;
          case JOB.confirmSweep:
            return this.confirm.check(BigInt(job.data.sweepId));
        }
      },
      { connection, concurrency: 3 },
    );
    sweepsWorker.on('failed', async (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      this.log.warn(`job ${job.name} ${job.id} failed (attempt ${job.attemptsMade}${final ? ', final' : ''}): ${err.message}`);
      if (final && job.name === JOB.runSweep) {
        await this.lifecycle.fail(BigInt(job.data.sweepId), `exhausted retries: ${err.message}`, { retryable: true }).catch((e) => this.log.error(errMessage(e)));
      }
    });

    const maintenanceWorker = new Worker(
      QUEUE.maintenance,
      async (job: Job) => {
        switch (job.name) {
          case JOB.refreshBalance:
            await this.addresses.refreshFromChain(BigInt(job.data.addressId));
            return;
          case JOB.reconcile:
            return this.reconciliation.run();
          case 'recover':
            return this.recovery.run(job.data.actor ?? 'system');
        }
      },
      { connection, concurrency: 2 },
    );

    const payoutsWorker = new Worker(
      QUEUE.payouts,
      async (job: Job) => {
        switch (job.name) {
          case JOB.runPayout:
            await this.payouts.run(BigInt(job.data.payoutId));
            return;
          case JOB.confirmPayout:
            return this.payouts.check(BigInt(job.data.payoutId));
        }
      },
      { connection, concurrency: 2 },
    );
    payoutsWorker.on('failed', async (job, err) => {
      if (job && job.name === JOB.runPayout && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        await this.payouts.fail(BigInt(job.data.payoutId), `exhausted retries: ${err.message}`, { retryable: true }).catch((e) => this.log.error(errMessage(e)));
      }
    });

    this.workers = [depositsWorker, sweepsWorker, maintenanceWorker, payoutsWorker];
    for (const w of this.workers) w.on('error', (e) => this.log.error(`worker ${w.name} error: ${e.message}`));
    this.log.log('workers started');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
  }
}
