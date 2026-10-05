import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Queues } from '../infra/queues.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { SweepLifecycleService } from './sweep-lifecycle.service.js';

/** Polls the solidified receipt of a broadcast sweep. */
@Injectable()
export class SweepConfirmService {
  private readonly log = new Logger(SweepConfirmService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly node: TronNodeClient,
    private readonly lifecycle: SweepLifecycleService,
  ) {}

  async check(sweepId: bigint): Promise<'confirmed' | 'failed' | 'pending'> {
    const sweep = await this.prisma.sweep.findUnique({ where: { id: sweepId } });
    if (!sweep || sweep.status !== 'broadcast' || !sweep.txId) return sweep?.status === 'confirmed' ? 'confirmed' : 'failed';

    const info = await this.node.getSolidTransactionInfo(sweep.txId);
    if (info) {
      const result = info.receipt?.result ?? (info.result === 'FAILED' ? 'FAILED' : 'SUCCESS');
      if (result === 'SUCCESS') {
        await this.lifecycle.confirm(sweepId, {
          energyUsed: info.receipt?.energy_usage_total ?? 0,
          bandwidthUsed: info.receipt?.net_usage ?? 0,
          feeSun: BigInt(info.fee ?? 0),
        });
        return 'confirmed';
      }
      const detail = info.resMessage ? Buffer.from(info.resMessage, 'hex').toString('utf8') : '';
      await this.lifecycle.fail(sweepId, `on-chain ${result}${detail ? `: ${detail}` : ''}`, { retryable: result === 'OUT_OF_ENERGY' || result === 'OUT_OF_TIME' });
      return 'failed';
    }

    const now = Date.now();
    const expiredAt = sweep.expiration ? sweep.expiration.getTime() + 60_000 : now + 1;
    if (now > expiredAt) {
      // Cannot be included any more; head check to be safe, then retry with a fresh tx.
      const head = await this.node.getTransactionInfo(sweep.txId);
      if (!head) {
        await this.lifecycle.fail(sweepId, 'transaction expired without inclusion', { retryable: true });
        return 'failed';
      }
    }
    if (sweep.broadcastAt && now - sweep.broadcastAt.getTime() > this.cfg.CONFIRM_TIMEOUT_MS) {
      // A timeout is not proof of non-inclusion: if the head executed it, keep waiting for solidity.
      if (await this.node.getTransactionInfo(sweep.txId)) {
        this.log.warn(`sweep ${sweepId}: ${sweep.txId} executed on head but not solid after the confirmation timeout; still waiting`);
      } else {
        await this.lifecycle.fail(sweepId, `no solid receipt within ${this.cfg.CONFIRM_TIMEOUT_MS} ms`, { retryable: true });
        return 'failed';
      }
    }
    await this.queues.enqueueConfirmSweep(sweepId, 10_000);
    return 'pending';
  }
}
