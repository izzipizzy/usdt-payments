import { Global, Module } from '@nestjs/common';
import { SweepPlannerService } from './sweep-planner.service.js';
import { SweepRunnerService } from './sweep-runner.service.js';
import { SweepLifecycleService } from './sweep-lifecycle.service.js';
import { SweepConfirmService } from './sweep-confirm.service.js';

@Global()
@Module({
  providers: [SweepPlannerService, SweepRunnerService, SweepLifecycleService, SweepConfirmService],
  exports: [SweepPlannerService, SweepRunnerService, SweepLifecycleService, SweepConfirmService],
})
export class SweepsModule {}
