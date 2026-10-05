import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';
import { REDIS } from '../infra/redis.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Set of our deposit addresses (hex) shared through Redis so the watcher can filter logs in O(1)
 * without touching PostgreSQL per block. Rebuilt from the DB on startup; kept in memory in the watcher.
 */
@Injectable()
export class AddressSetService implements OnModuleInit {
  private readonly log = new Logger(AddressSetService.name);
  private local = new Set<string>();
  private lastSync = 0;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  get key(): string {
    return `addresses:hex:${this.cfg.network}`;
  }

  async onModuleInit(): Promise<void> {
    await this.rebuildFromDb();
  }

  async rebuildFromDb(): Promise<number> {
    const rows = await this.prisma.depositAddress.findMany({ select: { addressHex: true } });
    if (rows.length > 0) {
      const pipeline = this.redis.pipeline();
      for (let i = 0; i < rows.length; i += 1000) {
        pipeline.sadd(this.key, ...rows.slice(i, i + 1000).map((r) => r.addressHex));
      }
      await pipeline.exec();
    }
    this.local = new Set(rows.map((r) => r.addressHex));
    this.lastSync = Date.now();
    this.log.log(`address set: ${rows.length} addresses`);
    return rows.length;
  }

  async add(addressHex: string): Promise<void> {
    await this.redis.sadd(this.key, addressHex);
    this.local.add(addressHex);
  }

  /** Cheap membership check from the in-memory copy, refreshed from Redis every 15 s. */
  async has(addressHex: string): Promise<boolean> {
    if (Date.now() - this.lastSync > 15_000) await this.syncFromRedis();
    return this.local.has(addressHex);
  }

  async syncFromRedis(): Promise<void> {
    const members = await this.redis.smembers(this.key);
    if (members.length > 0 || this.local.size === 0) this.local = new Set(members);
    this.lastSync = Date.now();
  }

  size(): number {
    return this.local.size;
  }
}
