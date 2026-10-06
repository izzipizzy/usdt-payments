import { ConflictException, Inject, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { formatTrx, formatUsdt, parseTrx } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CollectorService, SignerClient, SignerPolicyError } from '../signer/signer.client.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { AddressesService } from '../addresses/addresses.service.js';
import { AuditService } from '../common/audit.service.js';
import { explorerAddress, explorerBase } from '../common/explorer.js';
import { PoolAddressService } from '../energy/pool-address.service.js';
import { RecoveryService } from '../maintenance/recovery.service.js';

export interface WalletStatusDto {
  initialized: boolean;
  network: string;
  xpub: string | null;
  addressesIssued: number;
  /** Where sweeps land. `external` = cold address from COLLECTOR_ADDRESS; otherwise it is the main wallet. */
  collectorAddress: string | null;
  collectorUsdt: string;
  collectorExternal: boolean;
  explorerBase: string;
  /** Main wallet (account 2 of the phrase): holds the balance, receives sweeps (unless external collector), sends payouts. */
  main: { address: string; explorerUrl: string; usdtBalance: string; trxBalance: string; activated: boolean; isCollector: boolean } | null;
  /** Fee-paying wallet derived from the same phrase; null until the wallet exists. */
  pool: { address: string; explorerUrl: string; trxBalance: string; energyAvailable: number; activated: boolean; minTrx: string; lowBalance: boolean } | null;
  /** Hot wallet for outgoing payouts (account 2 of the phrase); null until the wallet exists. */
  payout: { address: string; explorerUrl: string; usdtBalance: string; trxBalance: string; activated: boolean } | null;
}

/** Simple-mode wallet setup: create or import a BIP39 phrase through the signer, bind its xpub in the DB. */
@Injectable()
export class WalletService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly signer: SignerClient,
    private readonly node: TronNodeClient,
    private readonly addresses: AddressesService,
    private readonly audit: AuditService,
    private readonly poolAddr: PoolAddressService,
    private readonly collector: CollectorService,
    private readonly recovery: RecoveryService,
  ) {}

  async status(): Promise<WalletStatusDto> {
    const [remote, issued, collectorUsdt] = await Promise.all([
      this.signer.walletStatus().catch(() => {
        throw new ServiceUnavailableException('Wallet signer is temporarily unavailable. Retry when the signer is running.');
      }),
      this.prisma.depositAddress.count({ where: { status: { in: ['assigned', 'suspended'] } } }),
      this.collector.get().then((c) => (c ? this.node.usdtBalanceOf(c).catch(this.mapNetworkError) : 0n)),
    ]);
    const collectorAddress = await this.collector.get();
    let pool: WalletStatusDto['pool'] = null;
    const poolAddress = remote.initialized ? await this.poolAddr.get() : null;
    if (poolAddress) {
      const [acc, res] = await Promise.all([this.node.getAccount(poolAddress).catch(this.mapNetworkError), this.node.getAccountResource(poolAddress).catch(this.mapNetworkError)]);
      const balance = acc?.balanceSun ?? 0n;
      pool = {
        address: poolAddress,
        explorerUrl: explorerAddress(this.cfg.network, poolAddress),
        trxBalance: formatTrx(balance),
        energyAvailable: res?.energyAvailable ?? 0,
        activated: acc !== null,
        minTrx: '100',
        lowBalance: balance < parseTrx('50'),
      };
    }
    let payout: WalletStatusDto['payout'] = null;
    if (remote.initialized && remote.payoutAddress) {
      const [acc, usdt] = await Promise.all([this.node.getAccount(remote.payoutAddress).catch(this.mapNetworkError), this.node.usdtBalanceOf(remote.payoutAddress).catch(this.mapNetworkError)]);
      payout = {
        address: remote.payoutAddress,
        explorerUrl: explorerAddress(this.cfg.network, remote.payoutAddress),
        usdtBalance: formatUsdt(usdt),
        trxBalance: formatTrx(acc?.balanceSun ?? 0n),
        activated: acc !== null,
      };
    }
    const main = payout ? { ...payout, isCollector: !this.collector.external() } : null;
    return {
      pool,
      payout,
      main,
      initialized: remote.initialized,
      network: this.cfg.network,
      xpub: remote.xpub,
      addressesIssued: issued,
      collectorAddress,
      collectorUsdt: formatUsdt(collectorUsdt),
      collectorExternal: this.collector.external(),
      explorerBase: explorerBase(this.cfg.network),
    };
  }

  async create(words: 12 | 24, actor: string, ip?: string): Promise<{ mnemonic: string; xpub: string; firstAddress: string }> {
    const res = await this.signer.walletCreate(words).catch(this.mapError);
    await this.addresses.registerWallet(res.xpub);
    this.poolAddr.invalidate();
    this.collector.invalidate();
    await this.audit.record({ actor, action: 'wallet.create', details: { words, firstAddress: res.firstAddress }, ip });
    return res;
  }

  async import(mnemonic: string, actor: string, ip?: string): Promise<{ xpub: string; firstAddress: string }> {
    const res = await this.signer.walletImport(mnemonic).catch(this.mapError);
    await this.addresses.registerWallet(res.xpub);
    this.poolAddr.invalidate();
    this.collector.invalidate();
    await this.audit.record({ actor, action: 'wallet.import', details: { firstAddress: res.firstAddress }, ip });
    // An imported phrase usually has history: rebuild addresses, deposits and stranded hops from the chain.
    await this.recovery.enqueue(actor).catch(() => false);
    return res;
  }

  private mapNetworkError = (): never => {
    throw new ServiceUnavailableException('Cannot read TRON network data. Check the TronGrid API key, request limits and connection, then retry.');
  };

  private mapError = (e: unknown): never => {
    if (e instanceof SignerPolicyError) {
      if (e.code === 'INVALID_MNEMONIC') throw new UnprocessableEntityException(e.message);
      throw new ConflictException(e.message);
    }
    throw new ConflictException(`signer unavailable: ${(e as Error).message}`);
  };
}
