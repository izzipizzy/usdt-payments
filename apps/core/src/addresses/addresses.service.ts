import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HDKey } from '@scure/bip32';
import { Prisma, type DepositAddress, type Wallet } from '@prisma/client';
import { addressFromPublicKey, type CreateAddressRequest } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignerClient } from '../signer/signer.client.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { AuditService } from '../common/audit.service.js';
import { AddressSetService } from './address-set.service.js';
import { LabelsService } from '../backup/labels.service.js';

export class WalletNotInitializedError extends ConflictException {
  constructor() {
    super('wallet is not set up yet: create or import a seed phrase in the admin UI (Wallet page)');
  }
}

export class XpubMismatchError extends Error {
  constructor(index: number, fromSigner: string, fromXpub: string) {
    super(`address mismatch at index ${index}: signer=${fromSigner} xpub=${fromXpub}`);
    this.name = 'XpubMismatchError';
  }
}

@Injectable()
export class AddressesService {
  private readonly log = new Logger(AddressesService.name);
  private wallet: Wallet | null = null;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly signer: SignerClient,
    private readonly node: TronNodeClient,
    private readonly audit: AuditService,
    private readonly addressSet: AddressSetService,
    private readonly labels: LabelsService,
  ) {}

  /** The wallet row for this network; created on first use from the signer's xpub. */
  async ensureWallet(): Promise<Wallet> {
    if (this.wallet) return this.wallet;
    const existing = await this.prisma.wallet.findUnique({ where: { name: this.cfg.walletName } });
    if (existing) {
      if (existing.network !== this.cfg.network) throw new Error(`wallet ${existing.name} belongs to ${existing.network}, config says ${this.cfg.network}`);
      // Guard against the signer having been swapped for another seed.
      const remote = await this.signer.walletStatus().catch(() => null);
      if (remote?.initialized && remote.xpub !== existing.xpub) throw new Error('signer xpub differs from the wallet xpub stored in DB — refusing to run');
      if (remote && !remote.initialized) throw new WalletNotInitializedError();
      this.wallet = existing;
      return existing;
    }
    const status = await this.signer.walletStatus();
    if (!status.initialized || !status.xpub) throw new WalletNotInitializedError();
    if (status.network !== this.cfg.network) throw new Error(`signer network ${status.network} != ${this.cfg.network}`);
    await this.assertNoCollision(status.xpub, status.mainAddress);
    this.wallet = await this.prisma.wallet.create({
      data: { name: this.cfg.walletName, network: this.cfg.network, xpub: status.xpub, nextIndex: this.cfg.ADDRESS_START_INDEX },
    });
    this.log.log(`wallet ${this.wallet.name} created from signer xpub`);
    return this.wallet;
  }

  /** Called after the signer created or imported a seed: bind (or re-bind, if unused) the wallet row. */
  async registerWallet(xpub: string): Promise<Wallet> {
    const existing = await this.prisma.wallet.findUnique({ where: { name: this.cfg.walletName }, include: { _count: { select: { addresses: true } } } });
    if (existing && existing.xpub !== xpub && existing._count.addresses > 0) {
      throw new ConflictException('the database already has addresses from a different seed; reset the database before importing another phrase');
    }
    const remote = await this.signer.walletStatus().catch(() => null);
    await this.assertNoCollision(xpub, remote?.mainAddress ?? null);
    const start = this.cfg.ADDRESS_START_INDEX;
    const row = existing
      ? await this.prisma.wallet.update({ where: { id: existing.id }, data: { xpub, nextIndex: existing.xpub === xpub ? Math.max(existing.nextIndex, start) : start } })
      : await this.prisma.wallet.create({ data: { name: this.cfg.walletName, network: this.cfg.network, xpub, nextIndex: start } });
    this.wallet = row;
    return row;
  }

  invalidateWallet(): void {
    this.wallet = null;
  }

  /**
   * The main wallet must never be one of the deposit addresses (it would be "swept" to itself and shown to a
   * counterparty). Happens when MAIN_WALLET_PATH is m/44'/195'/0'/0/0 without ADDRESS_START_INDEX=1.
   */
  private async assertNoCollision(xpub: string, mainAddress: string | null): Promise<void> {
    if (!mainAddress) return;
    for (let i = this.cfg.ADDRESS_START_INDEX; i < this.cfg.ADDRESS_START_INDEX + 5; i++) {
      const child = HDKey.fromExtendedKey(xpub).deriveChild(0).deriveChild(i);
      if (child.publicKey && addressFromPublicKey(child.publicKey).base58 === mainAddress) {
        throw new Error(`main wallet ${mainAddress} is deposit index ${i}: set ADDRESS_START_INDEX=${i + 1} (core) when MAIN_WALLET_PATH points into the deposit branch`);
      }
    }
  }

  verifyWithXpub(xpub: string, index: number, fromSigner: { address: string; publicKey: string }): void {
    const child = HDKey.fromExtendedKey(xpub).deriveChild(0).deriveChild(index);
    if (!child.publicKey) throw new Error('xpub derivation failed');
    const { base58 } = addressFromPublicKey(child.publicKey);
    if (base58 !== fromSigner.address) throw new XpubMismatchError(index, fromSigner.address, base58);
  }

  /** Reserve `count` consecutive indices atomically. */
  private async reserveIndices(walletId: bigint, count: number): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<Array<{ next_index: number }>>(
      Prisma.sql`UPDATE wallets SET next_index = next_index + ${count} WHERE id = ${walletId} RETURNING next_index`,
    );
    const end = rows[0].next_index;
    return Array.from({ length: count }, (_, i) => end - count + i);
  }

  /** Derive `count` new addresses into the `available` pool. */
  async deriveNew(count: number): Promise<DepositAddress[]> {
    if (count <= 0) return [];
    const wallet = await this.ensureWallet();
    const indices = await this.reserveIndices(wallet.id, count);
    const derived = await this.signer.deriveBatch(indices);
    const created: DepositAddress[] = [];
    for (const d of derived) {
      try {
        this.verifyWithXpub(wallet.xpub, d.index, d);
      } catch (e) {
        await this.audit.record({ actor: 'system', action: 'address.xpub_mismatch', details: { index: d.index, error: (e as Error).message } });
        throw e;
      }
      const row = await this.prisma.depositAddress.create({
        data: {
          walletId: wallet.id,
          derivationIndex: d.index,
          address: d.address,
          addressHex: d.addressHex,
          publicKey: d.publicKey,
          status: 'available',
        },
      });
      await this.addressSet.add(row.addressHex);
      created.push(row);
    }
    return created;
  }

  /** Keep ADDRESS_POOL_SIZE unassigned addresses ready so issuance does not depend on signer uptime. */
  async warmPool(): Promise<number> {
    const target = this.cfg.ADDRESS_POOL_SIZE;
    if (target === 0) return 0;
    const available = await this.prisma.depositAddress.count({ where: { status: 'available' } });
    const missing = target - available;
    if (missing <= 0) return 0;
    const created = await this.deriveNew(Math.min(missing, 100));
    return created.length;
  }

  /** Idempotent by alias. */
  async create(req: CreateAddressRequest, actor = 'api'): Promise<{ address: DepositAddress; created: boolean }> {
    const existing = await this.prisma.depositAddress.findUnique({ where: { alias: req.alias } });
    if (existing) return { address: existing, created: false };

    const assigned = await this.prisma.$transaction(async (tx) => {
      const again = await tx.depositAddress.findUnique({ where: { alias: req.alias } });
      if (again) return again;
      const candidates = await tx.$queryRaw<Array<{ id: bigint }>>(
        Prisma.sql`SELECT id FROM deposit_addresses WHERE status = 'available' ORDER BY derivation_index ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (candidates.length === 0) return null;
      return tx.depositAddress.update({
        where: { id: candidates[0].id },
        data: { alias: req.alias, status: 'assigned', metadata: (req.metadata ?? undefined) as object | undefined },
      });
    });
    if (assigned) {
      if (assigned.alias === req.alias && assigned.status === 'assigned') {
        await this.audit.record({ actor, action: 'address.assign', subjectType: 'address', subjectId: assigned.id, details: { alias: req.alias } });
        this.labels.scheduleWrite();
      }
      return { address: assigned, created: true };
    }

    // Pool empty: derive one synchronously. The fresh row is `available` for a moment, so another request may
    // legitimately claim it through the pool path above; claim it conditionally and fall back to a new round.
    const [fresh] = await this.deriveNew(1);
    try {
      const claimed = await this.prisma.depositAddress.updateMany({
        where: { id: fresh.id, status: 'available' },
        data: { alias: req.alias, status: 'assigned', metadata: (req.metadata ?? undefined) as object | undefined },
      });
      if (claimed.count !== 1) return this.create(req, actor);
      const row = await this.byId(fresh.id);
      await this.audit.record({ actor, action: 'address.assign', subjectType: 'address', subjectId: row.id, details: { alias: req.alias } });
      this.labels.scheduleWrite();
      return { address: row, created: true };
    } catch (e) {
      // Lost a race on the alias unique index: return the winner.
      const winner = await this.prisma.depositAddress.findUnique({ where: { alias: req.alias } });
      if (winner) return { address: winner, created: false };
      throw e;
    }
  }

  async byAlias(alias: string): Promise<DepositAddress> {
    const row = await this.prisma.depositAddress.findUnique({ where: { alias } });
    if (!row) throw new NotFoundException(`alias ${alias} not found`);
    return row;
  }

  async byId(id: bigint): Promise<DepositAddress> {
    const row = await this.prisma.depositAddress.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`address ${id} not found`);
    return row;
  }

  /** Re-read USDT balance and activation state from chain, update the cache. */
  async refreshFromChain(id: bigint): Promise<DepositAddress> {
    const row = await this.byId(id);
    const [balance, account] = await Promise.all([this.node.usdtBalanceOf(row.address), this.node.getAccount(row.address)]);
    const activated = account !== null;
    return this.prisma.depositAddress.update({
      where: { id },
      data: {
        usdtBalanceCached: balance,
        balanceCheckedAt: new Date(),
        onchainStatus: activated ? 'activated' : 'inactive',
        activatedAt: activated && !row.activatedAt ? new Date() : row.activatedAt,
      },
    });
  }

  async suspend(id: bigint, reason: string | undefined, actor: string, ip?: string): Promise<DepositAddress> {
    const row = await this.byId(id);
    if (row.status === 'suspended') return row;
    if (row.status !== 'assigned') throw new ConflictException(`cannot suspend address in status ${row.status}`);
    const updated = await this.prisma.depositAddress.update({ where: { id }, data: { status: 'suspended', suspendReason: reason ?? null } });
    await this.audit.record({ actor, action: 'address.suspend', subjectType: 'address', subjectId: id, details: { reason }, ip });
    this.labels.scheduleWrite();
    return updated;
  }

  async resume(id: bigint, actor: string, ip?: string): Promise<DepositAddress> {
    const row = await this.byId(id);
    if (row.status !== 'suspended') throw new ConflictException(`address is not suspended (${row.status})`);
    const updated = await this.prisma.depositAddress.update({ where: { id }, data: { status: 'assigned', suspendReason: null } });
    await this.audit.record({ actor, action: 'address.resume', subjectType: 'address', subjectId: id, ip });
    this.labels.scheduleWrite();
    return updated;
  }
}
