import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Deposit } from '@prisma/client';
import { hexToBase58, parseUsdt } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Queues } from '../infra/queues.js';
import { SettingsService } from '../settings/settings.service.js';
import { TronNodeClient } from '../tron/tron-node.client.js';

@Injectable()
export class DepositsService {
  private readonly log = new Logger(DepositsService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly settings: SettingsService,
    private readonly node: TronNodeClient,
  ) {}

  /** Turn one inbox event into a deposit. Safe to run many times. */
  async processChainEvent(chainEventId: bigint): Promise<Deposit | null> {
    const event = await this.prisma.chainEvent.findUnique({ where: { id: chainEventId }, include: { deposit: true } });
    if (!event) throw new Error(`chain event ${chainEventId} not found`);
    if (event.deposit) return event.deposit;
    if (event.processedAt) return null;

    if (event.contractHex !== this.cfg.usdtContractHex || event.receiptResult !== 'SUCCESS') {
      await this.prisma.chainEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), ignoredReason: 'not a successful USDT transfer' } });
      return null;
    }
    const address = await this.prisma.depositAddress.findUnique({ where: { addressHex: event.toHex } });
    if (!address) {
      await this.prisma.chainEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), ignoredReason: 'address not ours' } });
      return null;
    }

    const settings = await this.settings.get();
    const minDeposit = parseUsdt(settings.minDepositUsdt);
    const isDust = event.amount < minDeposit;
    const now = new Date();

    const deposit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deposit.upsert({
        where: { chainEventId: event.id },
        create: {
          depositAddressId: address.id,
          chainEventId: event.id,
          txId: event.txId,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          fromAddress: safeBase58(event.fromHex),
          amount: event.amount,
          status: isDust ? 'rejected' : 'confirmed',
          rejectReason: isDust ? 'dust' : null,
          confirmedAt: event.blockTimestamp,
        },
        update: {},
      });
      await tx.chainEvent.update({ where: { id: event.id }, data: { processedAt: now } });
      await tx.depositAddress.update({
        where: { id: address.id },
        data: {
          lastDepositAt: event.blockTimestamp,
          oldestUnsweptAt: address.oldestUnsweptAt ?? event.blockTimestamp,
        },
      });
      return created;
    });

    // Cache the on-chain balance (best effort; the sweep planner re-reads it anyway).
    try {
      const balance = await this.node.usdtBalanceOf(address.address);
      await this.prisma.depositAddress.update({ where: { id: address.id }, data: { usdtBalanceCached: balance, balanceCheckedAt: new Date() } });
    } catch (e) {
      this.log.warn(`balance refresh failed for ${address.address}: ${(e as Error).message}`);
    }

    if (address.status === 'assigned' || address.status === 'available') {
      await this.queues.enqueueEvaluateSweep(address.id, { delayMs: 2_000 });
    }
    this.log.log(`deposit ${deposit.id}: ${event.amount} raw USDT to ${address.alias ?? address.address} (${isDust ? 'dust' : 'confirmed'})`);
    return deposit;
  }

}

function safeBase58(hex: string): string {
  try {
    return hexToBase58(hex);
  } catch {
    return hex;
  }
}
