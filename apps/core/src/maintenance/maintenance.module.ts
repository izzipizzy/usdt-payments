import { Global, Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service.js';
import { SchedulerService } from './scheduler.service.js';
import { RecoveryService } from './recovery.service.js';

@Global()
@Module({
  providers: [ReconciliationService, SchedulerService, RecoveryService],
  exports: [ReconciliationService, SchedulerService, RecoveryService],
})
export class MaintenanceModule {}
