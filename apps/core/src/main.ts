import 'reflect-metadata';
import { loadDotenv } from '@usdt-trx/shared/env';
loadDotenv();
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { CONFIG, loadConfig, type AppConfig } from './config/config.js';
import { WorkersService } from './workers/workers.service.js';
import { SweepLifecycleService } from './sweeps/sweep-lifecycle.service.js';
import { PayoutsService } from './payouts/payouts.service.js';
import { AddressesService } from './addresses/addresses.service.js';

// Safety net: never let a BigInt reach JSON.stringify unformatted.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  // TRUST_PROXY decides how much of X-Forwarded-For is believed (audit IPs, rate limiting, ADMIN_ALLOWED_IPS).
  // Fastify accepts a hop count at runtime; the Nest adapter typing lags behind, hence the cast.
  const trustProxy = loadConfig().trustProxy as boolean | string[];
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ bodyLimit: 1024 * 1024, trustProxy }), {
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production', logLevels: ['error', 'warn', 'log'] }),
  });
  const cfg = app.get<AppConfig>(CONFIG);
  const log = new Logger('main');
  app.enableShutdownHooks();

  await app
    .get(AddressesService)
    .ensureWallet()
    .catch((e) => log.warn(`wallet not ready: ${(e as Error).message}`));
  if (cfg.RUN_WORKERS) {
    await app.get(WorkersService).start();
    await app.get(SweepLifecycleService).resume();
    await app.get(PayoutsService).resume();
  }
  await app.listen(cfg.PORT, cfg.HOST);
  log.log(`core listening on ${cfg.HOST}:${cfg.PORT} (${cfg.network}, workers=${cfg.RUN_WORKERS}, collector=${cfg.COLLECTOR_ADDRESS ?? 'main wallet'})`);
}

bootstrap().catch((e) => {
  console.error('core failed to start:', e);
  process.exit(1);
});
