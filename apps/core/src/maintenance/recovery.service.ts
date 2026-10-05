import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';
import { REDIS, RedisLock } from '../infra/redis.js';
import { Queues } from '../infra/queues.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignerClient } from '../signer/signer.client.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TronGridClient, type Trc20Transfer } from '../tron/trongrid.client.js';
import { AddressesService } from '../addresses/addresses.service.js';
import { AddressSetService } from '../addresses/address-set.service.js';
import { BlockScannerService } from '../watcher/block-scanner.service.js';
import { DepositsService } from '../deposits/deposits.service.js';
import { LabelsService } from '../backup/labels.service.js';
import { AuditService } from '../common/audit.service.js';

/** Stop after this many consecutive never-used derivation indices (BIP-44 gap limit). */
const GAP_LIMIT = 20;
const BATCH = 20;

export interface RecoveryStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  phase: string;
  addressesScanned: number;
  addressesRecovered: number;
  depositsIngested: number;
  sweepsRecovered: number;
  hopsScanned: number;
  hopsRecovered: number;
  errors: string[];
}

const EMPTY: RecoveryStatus = { state: 'idle', startedAt: null, finishedAt: null, phase: '', addressesScanned: 0, addressesRecovered: 0, depositsIngested: 0, sweepsRecovered: 0, hopsScanned: 0, hopsRecovered: 0, errors: [] };

/**
 * Rebuilds the database from the seed phrase + the chain, the way an HD wallet restores itself:
 * derive deposit addresses index by index, ask TronGrid for each one's USDT history, stop after GAP_LIMIT unused
 * indices. Used addresses get a row (label from LABELS_FILE when present, else `recovered-<index>`), every
 * incoming transfer is re-ingested through the normal deposit pipeline, outgoing transfers become confirmed sweep
 * rows. Then the one-time hop addresses are scanned for stranded USDT, which is returned to the main wallet as a
 * stage-2 recovery payout.
 */
@Injectable()
export class RecoveryService {
  private readonly log = new Logger(RecoveryService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly lock: RedisLock,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly signer: SignerClient,
    private readonly node: TronNodeClient,
    private readonly grid: TronGridClient,
    private readonly addresses: AddressesService,
    private readonly addressSet: AddressSetService,
    private readonly scanner: BlockScannerService,
    private readonly deposits: DepositsService,
    private readonly labels: LabelsService,
    private readonly audit: AuditService,
  ) {}

  private get key(): string {
    return `recovery:status:${this.cfg.network}`;
  }

  async status(): Promise<RecoveryStatus> {
    const raw = await this.redis.get(this.key);
    return raw ? (JSON.parse(raw) as RecoveryStatus) : EMPTY;
  }

  private async save(st: RecoveryStatus): Promise<void> {
    await this.redis.set(this.key, JSON.stringify(st), 'EX', 7 * 86_400);
  }

  /** Queue a scan (runs on the maintenance worker). */
  async enqueue(actor: string): Promise<boolean> {
    const st = await this.status();
    if (st.state === 'running') return false;
    await this.save({ ...EMPTY, state: 'running', startedAt: new Date().toISOString(), phase: 'queued' });
    await this.queues.maintenance.add('recover', { actor }, { jobId: `recover-${Date.now()}`, attempts: 1 });
    return true;
  }

  async run(actor = 'system'): Promise<RecoveryStatus> {
    const st: RecoveryStatus = { ...EMPTY, state: 'running', startedAt: new Date().toISOString() };
    const res = await this.lock.withLock(`lock:recovery:${this.cfg.network}`, 60 * 60_000, async () => {
      try {
        await this.scanDepositAddresses(st);
        await this.scanHopAddresses(st);
        st.state = 'done';
      } catch (e) {
        st.state = 'failed';
        st.errors.push((e as Error).message);
        this.log.error(`recovery failed: ${(e as Error).message}`);
      }
      st.finishedAt = new Date().toISOString();
      await this.save(st);
      await this.audit.record({ actor, action: 'recovery.scan', details: { ...st, errors: st.errors.slice(0, 20) } });
      this.labels.scheduleWrite();
      return st;
    });
    if (!res) {
      st.state = 'failed';
      st.finishedAt = new Date().toISOString();
      st.errors.push('another recovery scan is running');
      await this.save(st);
      return st;
    }
    return res;
  }

  private async scanDepositAddresses(st: RecoveryStatus): Promise<void> {
    st.phase = 'deposit addresses';
    const wallet = await this.addresses.ensureWallet();
    const labels = this.labels.readFile();
    const labelByIndex = new Map((labels?.addresses ?? []).map((a) => [a.index, a]));
    let index = this.cfg.ADDRESS_START_INDEX;
    let gap = 0;
    let maxUsed = -1;
    while (gap < GAP_LIMIT) {
      const batch = await this.signer.deriveBatch(Array.from({ length: BATCH }, (_, i) => index + i));
      for (const d of batch) {
        st.addressesScanned++;
        await this.save(st);
        const transfers = await this.grid.usdtTransfers(d.address);
        let row = await this.prisma.depositAddress.findUnique({ where: { addressHex: d.addressHex } });
        const used = transfers.length > 0 || (row !== null && row.status !== 'available');
        if (!used) {
          gap++;
          continue;
        }
        gap = 0;
        maxUsed = Math.max(maxUsed, d.index);
        if (!row) {
          this.addresses.verifyWithXpub(wallet.xpub, d.index, d);
          const label = labelByIndex.get(d.index);
          row = await this.prisma.depositAddress.create({
            data: {
              walletId: wallet.id,
              derivationIndex: d.index,
              address: d.address,
              addressHex: d.addressHex,
              publicKey: d.publicKey,
              status: label?.suspended ? 'suspended' : 'assigned',
              alias: label?.alias ?? `recovered-${d.index}`,
              metadata: (label?.metadata ?? undefined) as object | undefined,
              suspendReason: label?.suspendReason ?? null,
            },
          });
          await this.addressSet.add(row.addressHex);
          st.addressesRecovered++;
        } else if (row.status === 'available' && transfers.length > 0) {
          const label = labelByIndex.get(d.index);
          row = await this.prisma.depositAddress.update({ where: { id: row.id }, data: { status: 'assigned', alias: label?.alias ?? `recovered-${d.index}` } });
          st.addressesRecovered++;
        }
        await this.ingestHistory(row.id, d.address, transfers, st);
      }
      index += BATCH;
    }
    if (maxUsed + 1 > wallet.nextIndex) {
      await this.prisma.wallet.update({ where: { id: wallet.id }, data: { nextIndex: maxUsed + 1 } });
      this.addresses.invalidateWallet();
    }
  }

  /** Incoming transfers → chain_events → deposits (normal pipeline, synchronous); outgoing → confirmed sweeps. */
  private async ingestHistory(addressId: bigint, address: string, transfers: Trc20Transfer[], st: RecoveryStatus): Promise<void> {
    for (const t of transfers) {
      if (t.to !== address) continue;
      try {
        const ids = await this.scanner.ingestTransaction(t.txId);
        for (const id of ids) {
          await this.deposits.processChainEvent(id);
          st.depositsIngested++;
        }
      } catch (e) {
        st.errors.push(`deposit ${t.txId}: ${(e as Error).message}`);
      }
    }
    for (const t of transfers) {
      if (t.from !== address) continue;
      if (await this.prisma.sweep.findFirst({ where: { txId: t.txId } })) continue;
      const when = new Date(t.timestampMs);
      // Everything that had arrived by then and is not yet linked to a sweep left with this transfer.
      const swept = await this.prisma.deposit.findMany({ where: { depositAddressId: addressId, sweepId: null, status: { in: ['confirmed', 'credited'] }, confirmedAt: { lte: when } }, select: { id: true } });
      const sweep = await this.prisma.sweep.create({
        data: { depositAddressId: addressId, collectorAddress: t.to, amount: t.value, status: 'confirmed', energySource: 'none', txId: t.txId, broadcastAt: when, confirmedAt: when, lastError: 'recovered from chain history' },
      });
      if (swept.length > 0) {
        await this.prisma.sweepDeposit.createMany({ data: swept.map((d) => ({ sweepId: sweep.id, depositId: d.id })), skipDuplicates: true });
        await this.prisma.deposit.updateMany({ where: { id: { in: swept.map((d) => d.id) } }, data: { sweepId: sweep.id, status: 'swept', sweptAt: when } });
      }
      st.sweepsRecovered++;
    }
    await this.prisma.depositAddress.update({ where: { id: addressId }, data: { lastSweepAt: undefined } }).catch(() => undefined);
    await this.save(st);
  }

  /** One-time payout hop addresses: anything still sitting there goes back to the main wallet. */
  private async scanHopAddresses(st: RecoveryStatus): Promise<void> {
    st.phase = 'payout hop addresses';
    const status = await this.signer.walletStatus();
    const main = status.mainAddress;
    if (!main) return;
    let index = 0;
    let gap = 0;
    while (gap < GAP_LIMIT) {
      for (let i = index; i < index + BATCH; i++) {
        st.hopsScanned++;
        const hop = await this.signer.deriveTemp(i);
        const transfers = await this.grid.usdtTransfers(hop.address);
        if (transfers.length === 0) {
          gap++;
          continue;
        }
        gap = 0;
        const balance = await this.node.usdtBalanceOf(hop.address);
        if (balance <= 0n) continue;
        const existing = await this.prisma.payout.findUnique({ where: { id: BigInt(i) } });
        if (existing) {
          if (['confirmed', 'cancelled'].includes(existing.status)) st.errors.push(`hop ${i} holds ${balance} raw USDT but payout ${i} is ${existing.status}: return it manually`);
          continue; // active or failed payouts are handled by the normal retry flow
        }
        await this.prisma.payout.create({
          data: { id: BigInt(i), externalId: `recover-hop-${i}`, fromAddress: main, viaAddress: hop.address, toAddress: main, amount: balance, note: 'recovery: USDT found on a one-time hop address, returning to the main wallet', status: 'planned', stage: 2, createdBy: 'recovery' },
        });
        await this.prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('payouts', 'id'), GREATEST((SELECT MAX(id) FROM payouts), 1))`;
        await this.queues.enqueueRunPayout(BigInt(i), 0);
        st.hopsRecovered++;
      }
      await this.save(st);
      index += BATCH;
    }
  }
}
