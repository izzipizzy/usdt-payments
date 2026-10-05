import { Global, Module } from '@nestjs/common';
import { DepositsService } from './deposits.service.js';

@Global()
@Module({
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
