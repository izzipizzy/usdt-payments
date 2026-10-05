import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, type AppConfig } from './config.js';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
