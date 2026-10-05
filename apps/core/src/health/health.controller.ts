import { Controller, Get, Inject, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';
import { REDIS } from '../infra/redis.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlockScannerService } from '../watcher/block-scanner.service.js';

@Controller()
export class HealthController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly scanner: BlockScannerService,
  ) {}

  @Get('health')
  async health() {
    const [db, redis, watcher] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping().then((r) => r === 'PONG').catch(() => false),
      this.scanner.readStatus().catch(() => null),
    ]);
    return { ok: db && redis, network: this.cfg.network, db, redis, watcher };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
