import { Global, Module } from '@nestjs/common';
import { TronNodeClient } from './tron-node.client.js';
import { ChainParamsService } from './chain-params.service.js';
import { TxBuilderService } from './tx-builder.service.js';
import { TronGridClient } from './trongrid.client.js';

@Global()
@Module({
  providers: [TronNodeClient, ChainParamsService, TxBuilderService, TronGridClient],
  exports: [TronNodeClient, ChainParamsService, TxBuilderService, TronGridClient],
})
export class TronModule {}
