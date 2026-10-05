import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';

export const REDIS = Symbol('REDIS');

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

/** Simple lease lock on Redis (SET NX PX + compare-and-delete). Enough for "one watcher at a time". */
@Injectable()
export class RedisLock {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number, token: string): Promise<boolean> {
    const res = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }

  async renew(key: string, ttlMs: number, token: string): Promise<boolean> {
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
    const res = (await this.redis.eval(script, 1, key, token, String(ttlMs))) as number;
    return res === 1;
  }

  async release(key: string, token: string): Promise<void> {
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    await this.redis.eval(script, 1, key, token);
  }

  /** Run fn while holding the lock; returns null if the lock is taken. */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = `${process.pid}:${Date.now()}:${Math.random()}`;
    if (!(await this.acquire(key, ttlMs, token))) return null;
    try {
      return await fn();
    } finally {
      await this.release(key, token);
    }
  }
}

@Injectable()
export class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS, useFactory: (cfg: AppConfig) => createRedis(cfg.REDIS_URL), inject: [CONFIG] },
    RedisLock,
    RedisLifecycle,
  ],
  exports: [REDIS, RedisLock],
})
export class RedisModule {}
