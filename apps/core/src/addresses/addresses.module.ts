import { Global, Module } from '@nestjs/common';
import { AddressSetService } from './address-set.service.js';
import { AddressesService } from './addresses.service.js';

@Global()
@Module({
  providers: [AddressSetService, AddressesService],
  exports: [AddressSetService, AddressesService],
})
export class AddressesModule {}
