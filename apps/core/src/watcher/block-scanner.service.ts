import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { decodeTransferLog } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { REDIS } from '../infra/redis.js';
import { Queues } from '../infra/queues.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TronNodeClient, type TxInfo } from '../tron/tron-node.client.js';
import { AddressSetService } from '../addresses/address-set.service.js';

export interface ExtractedEvent {
  txId: string;
  logIndex: number;
  blockNumber: number;
  blockTimestampMs: number;
  contractHex: string;
  fromHex: string;
  toHex: string;
  amount: bigint;
  receiptResult: string;
  raw: unknown;
}

export interface WatcherStatus {
  solidBlock: number | null;
  cursorBlock: number | null;
  lagBlocks: number | null;
  updatedAt: string | null;
  addresses: number;
}

/**
 * Scans solidified blocks for USDT Transfer logs into our addresses and writes them to the
 * chain_events inbox. Cursor moves in the same transaction as the inserts; re-scans are no-ops
 * thanks to UNIQUE(network, tx_id, log_index).
 */
@Injectable()
export class BlockScannerService {
  private readonly log = new Logger(BlockScannerService.name);
  private readonly usdtHex: string;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly node: TronNodeClient,
    private readonly addresses: AddressSetService,
    private readonly queues: Queues,
  ) {
    this.usdtHex = cfg.usdtContractHex;
  }

  get statusKey(): string {
    return `watcher:status:${this.cfg.network}`;
  }

  /** Pure extraction, unit-tested separately. `isOurs` decides membership. */
  static extract(infos: TxInfo[], usdtHex: string, isOurs: (toHex: string) => boolean): ExtractedEvent[] {
    const out: ExtractedEvent[] = [];
    for (const info of infos) {
      const receiptResult = info.receipt?.result ?? (info.result === 'FAILED' ? 'FAILED' : 'SUCCESS');
      if (receiptResult !== 'SUCCESS') continue;
      const logs = info.log ?? [];
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        if (log.address !== usdtHex) continue;
        const transfer = decodeTransferLog(log.topics, log.data);
        if (!transfer) continue;
        if (!isOurs(transfer.toHex)) continue;
        out.push({
          txId: info.id.toLowerCase(),
          logIndex: i,
          blockNumber: info.blockNumber,
          blockTimestampMs: info.blockTimeStamp,
          contractHex: log.address,
          fromHex: transfer.fromHex,
          toHex: transfer.toHex,
          amount: transfer.amount,
          receiptResult,
          raw: { log, receipt: info.receipt ?? null, fee: info.fee ?? null },
        });
      }
    }
    return out;
  }

  async getCursor(): Promise<number | null> {
    const row = await this.prisma.chainCursor.findUnique({ where: { network_kind: { network: this.cfg.network, kind: 'solid' } } });
    return row ? Number(row.blockNumber) : null;
  }

  /** First run: start from WATCHER_START_BLOCK or the current solid block. */
  async initCursor(): Promise<number> {
    const existing = await this.getCursor();
    if (existing !== null) return existing;
    const start = this.cfg.WATCHER_START_BLOCK ?? (await this.node.getNowSolidBlock()).number;
    await this.prisma.chainCursor.create({ data: { network: this.cfg.network, kind: 'solid', blockNumber: BigInt(start) } });
    this.log.log(`cursor initialised at block ${start}`);
    return start;
  }

  /** Scan up to WATCHER_BATCH_BLOCKS blocks. Returns how many blocks/events were processed. */
  async scanOnce(): Promise<{ scanned: number; events: number; cursor: number; solid: number }> {
    const cursor = await this.initCursor();
    const solid = (await this.node.getNowSolidBlock()).number;
    const target = Math.min(solid, cursor + this.cfg.WATCHER_BATCH_BLOCKS);
    let events = 0;
    let last = cursor;
    for (let num = cursor + 1; num <= target; num++) {
      const infos = await this.node.getSolidTransactionInfoByBlock(num);
      const ourEvents: ExtractedEvent[] = [];
      for (const ev of BlockScannerService.extract(infos, this.usdtHex, () => true)) {
        if (await this.addresses.has(ev.toHex)) ourEvents.push(ev);
      }
      const blockTimestampMs = infos[0]?.blockTimeStamp ?? Date.now();
      const ids = await this.persistBlock(num, blockTimestampMs, ourEvents);
      for (const id of ids) await this.queues.enqueueProcessDeposit(id);
      events += ids.length;
      last = num;
    }
    await this.publishStatus(solid, last);
    return { scanned: target - cursor, events, cursor: last, solid };
  }

  /**
   * Recovery/backfill: ingest one already-solid transaction found through account history (TronGrid) instead of
   * the block scan. Same extraction, same inbox, same de-duplication; the cursor is not touched. Returns new ids.
   */
  async ingestTransaction(txId: string): Promise<bigint[]> {
    const info = await this.node.getSolidTransactionInfo(txId);
    if (!info) return [];
    const events: ExtractedEvent[] = [];
    for (const ev of BlockScannerService.extract([info], this.usdtHex, () => true)) {
      if (await this.addresses.has(ev.toHex)) events.push(ev);
    }
    if (events.length === 0) return [];
    return this.prisma.$transaction((tx) => this.insertEvents(tx, events));
  }

  private async insertEvents(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], events: ExtractedEvent[]): Promise<bigint[]> {
    const ids: bigint[] = [];
    for (const ev of events) {
      const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
        INSERT INTO chain_events (network, tx_id, log_index, block_number, block_timestamp, contract_hex, from_hex, to_hex, amount, receipt_result, raw)
        VALUES (${this.cfg.network}::"Network", ${ev.txId}, ${ev.logIndex}, ${BigInt(ev.blockNumber)}, ${new Date(ev.blockTimestampMs)},
                ${ev.contractHex}, ${ev.fromHex}, ${ev.toHex}, ${ev.amount}, ${ev.receiptResult}, ${JSON.stringify(ev.raw)}::jsonb)
        ON CONFLICT (network, tx_id, log_index) DO NOTHING
        RETURNING id`;
      if (rows.length === 1) ids.push(rows[0].id);
    }
    return ids;
  }

  /** Inserts new events only (ON CONFLICT DO NOTHING) and moves the cursor in the same transaction. */
  private async persistBlock(num: number, blockTimestampMs: number, events: ExtractedEvent[]): Promise<bigint[]> {
    return this.prisma.$transaction(async (tx) => {
      const ids = await this.insertEvents(tx, events);
      await tx.chainCursor.update({
        where: { network_kind: { network: this.cfg.network, kind: 'solid' } },
        data: { blockNumber: BigInt(num), blockTimestamp: new Date(blockTimestampMs) },
      });
      return ids;
    });
  }

  /** Safety net for a crash between commit and enqueue: re-enqueue events nobody processed. */
  async requeueUnprocessed(olderThanMs = 2 * 60_000): Promise<number> {
    const rows = await this.prisma.chainEvent.findMany({
      where: { network: this.cfg.network, processedAt: null, createdAt: { lt: new Date(Date.now() - olderThanMs) } },
      select: { id: true },
      take: 500,
    });
    for (const r of rows) await this.queues.enqueueProcessDeposit(r.id);
    return rows.length;
  }

  async publishStatus(solid: number, cursor: number): Promise<void> {
    const status: WatcherStatus = {
      solidBlock: solid,
      cursorBlock: cursor,
      lagBlocks: solid - cursor,
      updatedAt: new Date().toISOString(),
      addresses: this.addresses.size(),
    };
    await this.redis.set(this.statusKey, JSON.stringify(status), 'EX', 300);
    if (status.lagBlocks !== null && status.lagBlocks > this.cfg.WATCHER_LAG_ALERT_BLOCKS) {
      this.log.warn(`watcher lag ${status.lagBlocks} blocks (cursor ${cursor}, solid ${solid})`);
    }
  }

  async readStatus(): Promise<WatcherStatus> {
    const raw = await this.redis.get(this.statusKey);
    if (raw) return JSON.parse(raw) as WatcherStatus;
    const cursor = await this.getCursor();
    return { solidBlock: null, cursorBlock: cursor, lagBlocks: null, updatedAt: null, addresses: this.addresses.size() };
  }
}
