import { Global, Module } from '@nestjs/common';
import { ItrxProvider } from './itrx.provider.js';
import { OwnPoolProvider } from './own-pool.provider.js';
import { BurnProvider } from './burn.provider.js';
import { EnergyManagerService } from './energy-manager.service.js';
import { ItrxCallbackController } from './itrx-callback.controller.js';
import { PoolService } from './pool.service.js';
import { PoolAddressService } from './pool-address.service.js';

@Global()
@Module({
  controllers: [ItrxCallbackController],
  providers: [PoolAddressService, ItrxProvider, OwnPoolProvider, BurnProvider, EnergyManagerService, PoolService],
  exports: [EnergyManagerService, ItrxProvider, OwnPoolProvider, BurnProvider, PoolService, PoolAddressService],
})
export class EnergyModule {}
