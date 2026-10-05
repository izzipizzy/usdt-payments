import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config.js';
import { RedisLock } from '../infra/redis.js';
import { Queues } from '../infra/queues.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddressesService } from '../addresses/addresses.service.js';
import { SweepPlannerService } from '../sweeps/sweep-planner.service.js';
import { SweepLifecycleService } from '../sweeps/sweep-lifecycle.service.js';
import { BlockScannerService } from '../watcher/block-scanner.service.js';
import { SchedulerService } from './scheduler.service.js';

function fixture(runWorkers: boolean) {
  const cfg = loadConfig({ DATABASE_URL: 'postgresql://local', SIGNER_TOKEN: 'test', RUN_WORKERS: String(runWorkers) });
  const withLock = vi.fn(async (_name, _ttl, fn) => fn());
  const warmPool = vi.fn(async () => 0);
  const service = new SchedulerService(cfg, { withLock } as unknown as RedisLock, {} as Queues, {} as PrismaService,
    { warmPool } as unknown as AddressesService, {} as SweepPlannerService, {} as SweepLifecycleService, {} as BlockScannerService);
  return { service, withLock, warmPool };
}

describe('scheduler worker switch', () => {
  it('disables every periodic task when workers are disabled', async () => {
    const { service, withLock, warmPool } = fixture(false);
    await service.warmAddressPool();
    await service.sweepDue();
    await service.watchdog();
    await service.retryFailed();
    await service.reconcile();
    await service.requeueUnprocessedEvents();
    await service.expireResourceOps();
    expect(withLock).not.toHaveBeenCalled();
    expect(warmPool).not.toHaveBeenCalled();
  });

  it('runs periodic work under a lock when workers are enabled', async () => {
    const { service, withLock, warmPool } = fixture(true);
    await service.warmAddressPool();
    expect(withLock).toHaveBeenCalledOnce();
    expect(warmPool).toHaveBeenCalledOnce();
  });
});
