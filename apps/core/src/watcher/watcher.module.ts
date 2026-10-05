import { Global, Module } from '@nestjs/common';
import { BlockScannerService } from './block-scanner.service.js';
import { WatcherRunner } from './watcher.runner.js';

@Global()
@Module({
  providers: [BlockScannerService, WatcherRunner],
  exports: [BlockScannerService, WatcherRunner],
})
export class WatcherModule {}
