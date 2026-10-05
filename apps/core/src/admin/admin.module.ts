import { Module } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
import { WalletService } from './wallet.service.js';
import { AdminAuthService } from './auth.service.js';
import { AdminAuthController } from './auth.controller.js';
import { AdminSetupService } from './setup.service.js';
import { AdminSetupController } from './setup.controller.js';

@Module({
  controllers: [AdminSetupController, AdminAuthController, AdminController],
  providers: [AdminService, WalletService, AdminAuthService, AdminSetupService],
})
export class AdminModule {}
