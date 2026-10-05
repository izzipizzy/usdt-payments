import 'reflect-metadata';
import { loadDotenv } from '@usdt-trx/shared/env';
loadDotenv();
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WatcherAppModule } from './app.module.js';
import { WatcherRunner } from './watcher/watcher.runner.js';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WatcherAppModule, {
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production', logLevels: ['error', 'warn', 'log'] }),
  });
  app.enableShutdownHooks();
  const runner = app.get(WatcherRunner);
  const log = new Logger('watcher');
  const stop = async () => {
    log.log('stopping watcher');
    runner.stop();
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await runner.run();
  await app.close();
}

bootstrap().catch((e) => {
  console.error('watcher failed:', e);
  process.exit(1);
});
