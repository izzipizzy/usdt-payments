import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS } from './redis.js';

export const QUEUE = {
  deposits: 'deposits',
  sweeps: 'sweeps',
  maintenance: 'maintenance',
  payouts: 'payouts',
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const JOB = {
  processDeposit: 'process-deposit',
  evaluateSweep: 'evaluate-sweep',
  runSweep: 'run-sweep',
  confirmSweep: 'confirm-sweep',
  refreshBalance: 'refresh-balance',
  reconcile: 'reconcile',
  runPayout: 'run-payout',
  confirmPayout: 'confirm-payout',
} as const;

export const jobId = {
  processDeposit: (chainEventId: bigint) => `evt-${chainEventId}`,
  evaluateSweep: (addressId: bigint) => `eval-${addressId}`,
  runSweep: (sweepId: bigint, attempt: number) => `sweep-${sweepId}-${attempt}`,
  confirmSweep: (sweepId: bigint) => `confirm-${sweepId}`,
  refreshBalance: (addressId: bigint) => `bal-${addressId}`,
};

const DEFAULT_OPTS: JobsOptions = {
  removeOnComplete: true,
  removeOnFail: 1000,
  attempts: 5,
  backoff: { type: 'exponential', delay: 15_000 },
};

@Injectable()
export class Queues implements OnModuleDestroy {
  readonly deposits: Queue;
  readonly sweeps: Queue;
  readonly maintenance: Queue;
  readonly payouts: Queue;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    const connection = redis;
    this.deposits = new Queue(QUEUE.deposits, { connection, defaultJobOptions: DEFAULT_OPTS });
    this.sweeps = new Queue(QUEUE.sweeps, { connection, defaultJobOptions: DEFAULT_OPTS });
    this.maintenance = new Queue(QUEUE.maintenance, { connection, defaultJobOptions: { ...DEFAULT_OPTS, attempts: 2 } });
    this.payouts = new Queue(QUEUE.payouts, { connection, defaultJobOptions: DEFAULT_OPTS });
  }

  all(): Queue[] {
    return [this.deposits, this.sweeps, this.maintenance, this.payouts];
  }

  /**
   * Add a job with a deterministic id. BullMQ silently ignores an add whose id still exists, and failed jobs are
   * retained (removeOnFail), so a recovery re-enqueue would be a no-op: revive such a job instead.
   */
  private async addOrRetry(queue: Queue, name: string, data: Record<string, unknown>, opts: JobsOptions & { jobId: string }): Promise<void> {
    const existing = await queue.getJob(opts.jobId);
    if (existing && (await existing.isFailed())) {
      // Drop the exhausted job and add a fresh one so it gets the full attempts budget and the requested delay
      // (`job.retry()` keeps attemptsMade and ignores delay). A concurrent recovery may have done this already.
      try {
        await existing.remove();
      } catch {
        const state = await existing.getState().catch(() => 'unknown');
        if (state !== 'failed') return; // someone else revived it
        throw new Error(`cannot remove failed job ${opts.jobId} for re-enqueue`);
      }
    }
    await queue.add(name, data, opts);
  }

  async enqueueProcessDeposit(chainEventId: bigint): Promise<void> {
    await this.addOrRetry(this.deposits, JOB.processDeposit, { chainEventId: chainEventId.toString() }, { jobId: jobId.processDeposit(chainEventId) });
  }

  async enqueueEvaluateSweep(addressId: bigint, opts: { force?: boolean; actor?: string; delayMs?: number } = {}): Promise<void> {
    await this.sweeps.add(
      JOB.evaluateSweep,
      { addressId: addressId.toString(), force: opts.force ?? false, actor: opts.actor ?? 'system' },
      { jobId: opts.force ? `${jobId.evaluateSweep(addressId)}-force-${Date.now()}` : jobId.evaluateSweep(addressId), delay: opts.delayMs },
    );
  }

  async enqueueRunSweep(sweepId: bigint, attempt: number, delayMs = 0): Promise<void> {
    await this.addOrRetry(this.sweeps, JOB.runSweep, { sweepId: sweepId.toString(), attempt }, { jobId: jobId.runSweep(sweepId, attempt), delay: delayMs });
  }

  async enqueueConfirmSweep(sweepId: bigint, delayMs = 10_000): Promise<void> {
    // Confirm jobs re-schedule themselves; a unique suffix avoids the "same jobId still completing" race.
    await this.sweeps.add(
      JOB.confirmSweep,
      { sweepId: sweepId.toString() },
      { jobId: `${jobId.confirmSweep(sweepId)}-${Date.now()}`, delay: delayMs, attempts: 3 },
    );
  }

  async enqueueRunPayout(payoutId: bigint, attempt: number, delayMs = 0): Promise<void> {
    await this.addOrRetry(this.payouts, JOB.runPayout, { payoutId: payoutId.toString(), attempt }, { jobId: `payout-${payoutId}-${attempt}`, delay: delayMs });
  }

  async enqueueConfirmPayout(payoutId: bigint, delayMs = 10_000): Promise<void> {
    await this.payouts.add(JOB.confirmPayout, { payoutId: payoutId.toString() }, { jobId: `confirmpayout-${payoutId}-${Date.now()}`, delay: delayMs, attempts: 3 });
  }


  async enqueueRefreshBalance(addressId: bigint): Promise<void> {
    await this.maintenance.add(JOB.refreshBalance, { addressId: addressId.toString() }, { jobId: jobId.refreshBalance(addressId) });
  }

  async stats(): Promise<Array<{ name: string; waiting: number; active: number; failed: number; delayed: number; completed: number }>> {
    const out = [];
    for (const q of this.all()) {
      const c = await q.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
      out.push({ name: q.name, waiting: c.waiting ?? 0, active: c.active ?? 0, failed: c.failed ?? 0, delayed: c.delayed ?? 0, completed: c.completed ?? 0 });
    }
    return out;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.all().map((q) => q.close().catch(() => undefined)));
  }
}

@Global()
@Module({
  providers: [Queues],
  exports: [Queues],
})
export class QueuesModule {}
