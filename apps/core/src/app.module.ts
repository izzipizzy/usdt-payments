import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './infra/redis.js';
import { QueuesModule } from './infra/queues.js';
import { TronModule } from './tron/tron.module.js';
import { SignerModule } from './signer/signer.client.js';
import { SettingsModule } from './settings/settings.service.js';
import { AuditModule } from './common/audit.service.js';
import { AddressesModule } from './addresses/addresses.module.js';
import { WatcherModule } from './watcher/watcher.module.js';
import { DepositsModule } from './deposits/deposits.module.js';
import { EnergyModule } from './energy/energy.module.js';
import { SweepsModule } from './sweeps/sweeps.module.js';
import { PayoutsModule } from './payouts/payouts.module.js';
import { BackupModule } from './backup/labels.service.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { AdminModule } from './admin/admin.module.js';
import { HealthModule } from './health/health.controller.js';
import { WorkersService } from './workers/workers.service.js';

/** Shared infrastructure used by both the API/worker process and the watcher process. */
export const INFRA_MODULES = [
  ConfigModule,
  PrismaModule,
  RedisModule,
  QueuesModule,
  TronModule,
  SignerModule,
  SettingsModule,
  AuditModule,
  AddressesModule,
  WatcherModule,
  DepositsModule,
  EnergyModule,
  SweepsModule,
  PayoutsModule,
  BackupModule,
];

@Module({
  imports: [...INFRA_MODULES, ScheduleModule.forRoot(), MaintenanceModule, AdminModule, HealthModule],
  providers: [WorkersService],
})
export class AppModule {}

@Module({
  imports: [...INFRA_MODULES],
})
export class WatcherAppModule {}
