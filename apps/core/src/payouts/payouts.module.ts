import { Global, Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service.js';

@Global()
@Module({
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
