import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { RedisLock } from '../infra/redis.js';
import { sleep } from '../common/errors.js';
import { BlockScannerService } from './block-scanner.service.js';

/** Single-instance loop: holds a Redis lease, scans, sleeps when caught up. */
@Injectable()
export class WatcherRunner {
  private readonly log = new Logger(WatcherRunner.name);
  private stopping = false;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly lock: RedisLock,
    private readonly scanner: BlockScannerService,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    const key = `lock:watcher:${this.cfg.network}`;
    const token = `${process.pid}:${Date.now()}`;
    const ttl = 30_000;
    while (!this.stopping) {
      if (!(await this.lock.acquire(key, ttl, token))) {
        this.log.warn('another watcher holds the lock; retrying in 10 s');
        await sleep(10_000);
        continue;
      }
      this.log.log('watcher lock acquired');
      try {
        while (!this.stopping) {
          if (!(await this.lock.renew(key, ttl, token))) {
            this.log.error('lost watcher lock; stopping loop');
            break;
          }
          let caughtUp = true;
          try {
            const res = await this.scanner.scanOnce();
            caughtUp = res.cursor >= res.solid;
            if (res.events > 0) this.log.log(`scanned ${res.scanned} blocks, ${res.events} deposits (cursor ${res.cursor}/${res.solid})`);
          } catch (e) {
            this.log.error(`scan failed: ${(e as Error).message}`);
            await sleep(5_000);
          }
          if (caughtUp) await sleep(this.cfg.WATCHER_POLL_MS);
        }
      } finally {
        await this.lock.release(key, token);
      }
    }
  }
}
