import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DepositAddress, Sweep, SweepStatus } from '@prisma/client';
import { ENERGY_TRANSFER_NONZERO_RECIPIENT, ENERGY_TRANSFER_ZERO_RECIPIENT, type TronTxJson } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Queues } from '../infra/queues.js';
import { SettingsService } from '../settings/settings.service.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { TxBuilderService } from '../tron/tx-builder.service.js';
import { SignerClient, SignerPolicyError } from '../signer/signer.client.js';
import { EnergyManagerService } from '../energy/energy-manager.service.js';
import { NonRetryableError, RetryableError, errMessage, isRetryable } from '../common/errors.js';
import { SweepLifecycleService } from './sweep-lifecycle.service.js';

type SweepWithAddress = Sweep & { depositAddress: DepositAddress };

/**
 * Drives one sweep through: planned → (activating|energy_pending) → ready → signing → broadcast.
 * Every step is idempotent on the persisted status, so a crashed job simply re-runs.
 */
@Injectable()
export class SweepRunnerService {
  private readonly log = new Logger(SweepRunnerService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly settings: SettingsService,
    private readonly node: TronNodeClient,
    private readonly txb: TxBuilderService,
    private readonly signer: SignerClient,
    private readonly energy: EnergyManagerService,
    private readonly lifecycle: SweepLifecycleService,
  ) {}

  private async load(sweepId: bigint): Promise<SweepWithAddress> {
    const s = await this.prisma.sweep.findUnique({ where: { id: sweepId }, include: { depositAddress: true } });
    if (!s) throw new NonRetryableError(`sweep ${sweepId} not found`);
    return s;
  }

  /** Optimistic status transition; returns false if someone else moved the sweep. */
  private async transition(sweepId: bigint, from: SweepStatus | SweepStatus[], to: SweepStatus, data: Record<string, unknown> = {}): Promise<boolean> {
    const res = await this.prisma.sweep.updateMany({
      where: { id: sweepId, status: Array.isArray(from) ? { in: from } : from },
      data: { status: to, ...data },
    });
    return res.count === 1;
  }

  async run(sweepId: bigint): Promise<void> {
    try {
      for (let guard = 0; guard < 12; guard++) {
        const sweep = await this.load(sweepId);
        switch (sweep.status) {
          case 'planned':
          case 'activating':
          case 'energy_pending':
            await this.stepResources(sweep);
            break;
          case 'ready':
            await this.stepBuild(sweep);
            break;
          case 'signing':
            await this.stepSignAndBroadcast(sweep);
            break;
          case 'broadcast':
            await this.queues.enqueueConfirmSweep(sweep.id, 10_000);
            return;
          default:
            this.log.log(`sweep ${sweepId} is ${sweep.status}; nothing to do`);
            return;
        }
      }
      throw new RetryableError('sweep did not settle within the step budget');
    } catch (e) {
      if (isRetryable(e)) throw e; // BullMQ retries with backoff; status stays where it was
      await this.lifecycle.fail(sweepId, errMessage(e), { retryable: false });
    }
  }

  // ------------------------------------------------------------ steps

  private async stepResources(sweep: SweepWithAddress): Promise<void> {
    const address = sweep.depositAddress;
    if (address.status === 'suspended' || address.status === 'retired') {
      throw new NonRetryableError(`address is ${address.status}`, 'ADDRESS_STATE');
    }
    const settings = await this.settings.get();
    const [account, collectorBalance] = await Promise.all([this.node.getAccount(address.address), this.node.usdtBalanceOf(sweep.collectorAddress)]);
    const activate = account === null;
    const zeroRecipient = collectorBalance === 0n;
    if (zeroRecipient) this.log.warn(`collector ${sweep.collectorAddress} holds 0 USDT: this sweep costs ~2x energy`);

    await this.transition(sweep.id, ['planned', 'activating', 'energy_pending'], activate ? 'activating' : 'energy_pending');

    // Simulation runs against current state (so it includes the empty-recipient surcharge) and works even for a
    // not-yet-activated owner that already holds USDT. Constants are only the fallback when the node cannot simulate.
    let estimate = zeroRecipient ? ENERGY_TRANSFER_ZERO_RECIPIENT : ENERGY_TRANSFER_NONZERO_RECIPIENT;
    try {
      const sim = await this.node.estimateTransferEnergy(address.address, sweep.collectorAddress, sweep.amount);
      if (!sim.ok && !activate) {
        // The real transaction would fail the same way (blacklist, balance moved). Do not spend energy on it.
        throw new NonRetryableError(`transfer simulation failed: ${sim.message ?? 'unknown'}`, 'REVERT');
      }
      if (sim.ok && sim.energy > 0) estimate = sim.energy;
    } catch (e) {
      if (e instanceof NonRetryableError) throw e;
      this.log.warn(`energy simulation failed, using constant estimate: ${(e as Error).message}`);
    }
    const energyNeeded = Math.ceil(estimate * settings.energyMargin);

    const result = await this.energy.ensureEnergy({ sweepId: sweep.id, attempt: sweep.attempt }, address.address, energyNeeded, activate);
    await this.energy.ensureBandwidth({ sweepId: sweep.id, attempt: sweep.attempt }, address.address);
    const cost = await this.prisma.resourceOperation.aggregate({ _sum: { costSun: true }, where: { sweepId: sweep.id, status: 'delivered' } });
    await this.transition(sweep.id, ['activating', 'energy_pending'], 'ready', {
      energySource: result.source,
      energyEstimated: energyNeeded,
      resourceCostSun: cost._sum.costSun ?? 0n,
    });
    if (activate) {
      await this.prisma.depositAddress.update({ where: { id: address.id }, data: { onchainStatus: 'activated', activatedAt: new Date() } });
    }
  }

  private async stepBuild(sweep: SweepWithAddress): Promise<void> {
    const settings = await this.settings.get();
    const balance = await this.node.usdtBalanceOf(sweep.depositAddress.address);
    const amount = settings.leaveDustOnAddress ? balance - 1n : balance;
    if (amount <= 0n) throw new NonRetryableError('nothing to sweep: balance is zero', 'ZERO_BALANCE');

    const tx = await this.txb.usdtTransfer(sweep.depositAddress.address, sweep.collectorAddress, amount, BigInt(settings.feeLimitSun));
    const rawData = tx.raw_data as { ref_block_bytes: string; ref_block_hash: string; expiration: number };
    // Persist the transaction (and its id) BEFORE asking for a signature.
    const ok = await this.transition(sweep.id, 'ready', 'signing', {
      amount,
      txId: tx.txID,
      unsignedRaw: tx as object,
      signedRaw: null,
      refBlockBytes: rawData.ref_block_bytes,
      refBlockHash: rawData.ref_block_hash,
      expiration: new Date(rawData.expiration),
    });
    if (!ok) throw new RetryableError('sweep changed state during build');
  }

  private async stepSignAndBroadcast(sweep: SweepWithAddress): Promise<void> {
    const unsigned = sweep.unsignedRaw as unknown as TronTxJson | null;
    if (!unsigned || !sweep.expiration) {
      await this.transition(sweep.id, 'signing', 'ready');
      return;
    }
    // Nothing signed yet: rebuilding close to expiry is free and safe.
    const nearExpiry = sweep.expiration.getTime() < Date.now() + 30_000;
    // Signed: it may already be in the network (crash after broadcast, node lag). Only give up once the chain can no
    // longer include it AND the head confirms it never landed.
    const hardExpired = Date.now() > sweep.expiration.getTime() + 60_000;
    let signed = sweep.signedRaw as unknown as TronTxJson | null;

    if (!signed) {
      if (nearExpiry) {
        await this.rebuild(sweep, 'unsigned transaction expired');
        return;
      }
      try {
        const res = await this.signer.signSweep(sweep.depositAddress.derivationIndex, unsigned, sweep.id.toString());
        signed = { ...unsigned, signature: [res.signature] };
        await this.prisma.signerRequest.upsert({
          where: { unsignedHash: unsigned.txID },
          create: { kind: 'sweep', derivationIndex: sweep.depositAddress.derivationIndex, unsignedHash: unsigned.txID, sweepId: sweep.id, result: 'signed' },
          update: { result: 'signed' },
        });
        await this.prisma.sweep.update({ where: { id: sweep.id }, data: { signedRaw: signed as object } });
      } catch (e) {
        if (e instanceof SignerPolicyError) {
          await this.prisma.signerRequest.upsert({
            where: { unsignedHash: unsigned.txID },
            create: { kind: 'sweep', derivationIndex: sweep.depositAddress.derivationIndex, unsignedHash: unsigned.txID, sweepId: sweep.id, result: 'refused', error: `${e.code}: ${e.message}` },
            update: { result: 'refused', error: `${e.code}: ${e.message}` },
          });
          this.log.error(`SECURITY: signer refused sweep ${sweep.id}: ${e.code} ${e.message}`);
          throw new NonRetryableError(`signer policy refused: ${e.code} ${e.message}`, 'POLICY');
        }
        throw new RetryableError(`signer error: ${errMessage(e)}`, 'SIGNER');
      }
    }

    if (hardExpired) {
      // Signed but never confirmed. If the head already executed it, hand it to the confirm job; rebuild only when
      // the head has no trace of it.
      if (await this.node.getTransactionInfo(unsigned.txID)) return this.markBroadcast(sweep, unsigned.txID, 'already executed on head');
      await this.rebuild(sweep, 'signed transaction expired before broadcast');
      return;
    }

    // A still-valid signed tx is always (re)broadcast: DUP_TRANSACTION_ERROR counts as success, an expiration error rebuilds.
    const res = await this.node.broadcast(signed);
    if (res.ok) return this.markBroadcast(sweep, unsigned.txID, res.code);
    switch (res.code) {
      case 'TAPOS_ERROR':
      case 'TRANSACTION_EXPIRATION_ERROR':
        // The node may reject a tx it has already executed (old ref block / past expiry). Never rebuild one the head knows.
        if (await this.node.getTransactionInfo(unsigned.txID)) return this.markBroadcast(sweep, unsigned.txID, `${res.code} but executed on head`);
        await this.rebuild(sweep, `${res.code}: ${res.message ?? ''}`);
        return;
      case 'BANDWITH_ERROR':
      case 'BANDWIDTH_ERROR':
        await this.energy.ensureBandwidth({ sweepId: sweep.id, attempt: sweep.attempt }, sweep.depositAddress.address);
        throw new RetryableError(`broadcast ${res.code}; bandwidth topped up, retrying`, 'BANDWIDTH');
      case 'SERVER_BUSY':
      case 'NO_CONNECTION':
      case 'NOT_ENOUGH_EFFECTIVE_CONNECTION':
        throw new RetryableError(`broadcast ${res.code}`, res.code);
      default:
        throw new NonRetryableError(`broadcast rejected: ${res.code} ${res.message ?? ''}`, res.code);
    }
  }

  /** The signed tx is in the network (broadcast accepted, duplicate, or seen on head): hand it to the confirm job as-is. */
  private async markBroadcast(sweep: Sweep, txId: string, how: string): Promise<void> {
    const moved = await this.prisma.sweep.updateMany({ where: { id: sweep.id, status: 'signing', txId }, data: { status: 'broadcast', broadcastAt: new Date() } });
    if (moved.count === 1) this.log.log(`sweep ${sweep.id} broadcast ${txId} (${how})`);
    await this.queues.enqueueConfirmSweep(sweep.id, 10_000);
  }

  /** Discard the current (never included) transaction and go back to `ready`. */
  private async rebuild(sweep: Sweep, reason: string): Promise<void> {
    this.log.warn(`sweep ${sweep.id}: rebuilding transaction (${reason})`);
    await this.prisma.sweep.update({
      where: { id: sweep.id },
      data: { status: 'ready', txId: null, unsignedRaw: undefined, signedRaw: undefined, refBlockBytes: null, refBlockHash: null, expiration: null, lastError: reason },
    });
    // Prisma cannot set Json columns to SQL NULL through `undefined`; clear them explicitly.
    await this.prisma.$executeRaw`UPDATE sweeps SET unsigned_raw = NULL, signed_raw = NULL WHERE id = ${sweep.id}`;
  }
}
