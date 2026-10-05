import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatTrx, formatUsdt, type DashboardDto } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { parseEnum, parseId } from '../common/ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Queues } from '../infra/queues.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { ChainParamsService } from '../tron/chain-params.service.js';
import { EnergyManagerService } from '../energy/energy-manager.service.js';
import { BlockScannerService } from '../watcher/block-scanner.service.js';
import { CollectorService } from '../signer/signer.client.js';
import { explorerAddress } from '../common/explorer.js';
import { paginated, parsePage, type PageQuery } from '../common/pagination.js';
import { toAddressDto, toAuditDto, toDepositDto, toResourceOpDto, toSweepDto } from '../addresses/mappers.js';

@Injectable()
export class AdminService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly node: TronNodeClient,
    private readonly params: ChainParamsService,
    private readonly energy: EnergyManagerService,
    private readonly scanner: BlockScannerService,
    private readonly collector: CollectorService,
  ) {}

  async dashboard(): Promise<DashboardDto> {
    const since24h = new Date(Date.now() - 24 * 3_600_000);
    const collectorAddress = (await this.collector.get()) ?? '';
    const [collectorUsdt, collectorAcc, total, assigned, withBalance, usdtSum, sweeps, queues, providers, watcher, chain] = await Promise.all([
      collectorAddress ? this.node.usdtBalanceOf(collectorAddress).catch(() => 0n) : Promise.resolve(0n),
      collectorAddress ? this.node.getAccount(collectorAddress).catch(() => null) : Promise.resolve(null),
      this.prisma.depositAddress.count(),
      this.prisma.depositAddress.count({ where: { status: 'assigned' } }),
      this.prisma.depositAddress.count({ where: { usdtBalanceCached: { gt: 0n } } }),
      this.prisma.depositAddress.aggregate({ _sum: { usdtBalanceCached: true } }),
      this.prisma.sweep.findMany({ where: { createdAt: { gte: since24h } }, select: { status: true, resourceCostSun: true, trxFeeBurnedSun: true } }),
      this.queues.stats(),
      this.energy.providersStatus(),
      this.scanner.readStatus(),
      this.params.get(),
    ]);
    const cost = sweeps.reduce((acc, s) => acc + (s.resourceCostSun ?? 0n) + (s.trxFeeBurnedSun ?? 0n), 0n);
    return {
      network: this.cfg.network,
      collector: {
        address: collectorAddress,
        usdtBalance: formatUsdt(collectorUsdt),
        trxBalance: formatTrx(collectorAcc?.balanceSun ?? 0n),
        explorerUrl: collectorAddress ? explorerAddress(this.cfg.network, collectorAddress) : '',
      },
      addresses: { total, assigned, withBalance, usdtTotal: formatUsdt(usdtSum._sum.usdtBalanceCached ?? 0n) },
      watcher: { solidBlock: watcher.solidBlock, cursorBlock: watcher.cursorBlock, lagBlocks: watcher.lagBlocks, updatedAt: watcher.updatedAt },
      sweeps24h: {
        count: sweeps.length,
        confirmed: sweeps.filter((s) => s.status === 'confirmed').length,
        failed: sweeps.filter((s) => s.status === 'failed' || s.status === 'abandoned').length,
        costSun: cost.toString(),
        costTrx: formatTrx(cost),
      },
      queues: queues.map((q) => ({ name: q.name, waiting: q.waiting, active: q.active, failed: q.failed, delayed: q.delayed })),
      providers: providers.map((p) => ({ name: p.name, healthy: p.healthy, balanceSun: p.balanceSun, detail: p.detail })),
      chainParams: { energyFeeSun: chain.energyFeeSun, bandwidthFeeSun: chain.bandwidthFeeSun, createAccountFeeSun: chain.createAccountFeeSun },
    };
  }

  async listAddresses(q: PageQuery & { search?: string; status?: string; withBalance?: string; unsweptOlderThanHours?: string }) {
    const page = parsePage(q, ['createdAt', 'usdtBalanceCached', 'lastDepositAt', 'alias', 'derivationIndex']);
    const where: Prisma.DepositAddressWhereInput = {};
    if (q.search) where.OR = [{ alias: { contains: q.search, mode: 'insensitive' } }, { address: { contains: q.search } }];
    if (q.status) where.status = parseEnum(q.status, ['available', 'assigned', 'suspended', 'retired'] as const, 'status');
    if (q.withBalance === 'true') where.usdtBalanceCached = { gt: 0n };
    const hours = Number(q.unsweptOlderThanHours);
    if (hours > 0) where.oldestUnsweptAt = { lte: new Date(Date.now() - hours * 3_600_000) };
    const [rows, total] = await Promise.all([
      this.prisma.depositAddress.findMany({ where, orderBy: page.orderBy, skip: page.skip, take: page.take }),
      this.prisma.depositAddress.count({ where }),
    ]);
    return paginated(rows.map((r) => toAddressDto(this.cfg.network, r)), total, page);
  }

  async addressDetail(id: bigint) {
    const row = await this.prisma.depositAddress.findUnique({
      where: { id },
      include: {
        deposits: { orderBy: { createdAt: 'desc' }, take: 100 },
        sweeps: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!row) throw new NotFoundException('address not found');
    const brief = { alias: row.alias, address: row.address };
    return {
      ...toAddressDto(this.cfg.network, row),
      deposits: row.deposits.map((d) => toDepositDto(this.cfg.network, { ...d, depositAddress: brief })),
      sweeps: row.sweeps.map((s) => toSweepDto(this.cfg.network, { ...s, depositAddress: brief })),
    };
  }

  async listDeposits(q: PageQuery & { status?: string; alias?: string; txId?: string; addressId?: string }) {
    const page = parsePage(q, ['createdAt', 'amount', 'blockNumber', 'confirmedAt']);
    const where: Prisma.DepositWhereInput = {};
    if (q.status) where.status = parseEnum(q.status, ['confirmed', 'credited', 'sweeping', 'swept', 'rejected'] as const, 'status');
    if (q.alias) where.depositAddress = { alias: { contains: q.alias, mode: 'insensitive' } };
    if (q.txId) where.txId = q.txId.toLowerCase();
    if (q.addressId) where.depositAddressId = parseId(q.addressId, 'addressId');
    const [rows, total] = await Promise.all([
      this.prisma.deposit.findMany({ where, orderBy: page.orderBy, skip: page.skip, take: page.take, include: { depositAddress: { select: { alias: true, address: true } } } }),
      this.prisma.deposit.count({ where }),
    ]);
    return paginated(rows.map((d) => toDepositDto(this.cfg.network, d)), total, page);
  }

  async listSweeps(q: PageQuery & { status?: string; alias?: string; addressId?: string }) {
    const page = parsePage(q, ['createdAt', 'updatedAt', 'amount', 'status']);
    const where: Prisma.SweepWhereInput = {};
    if (q.status) where.status = parseEnum(q.status, ['planned', 'activating', 'energy_pending', 'ready', 'signing', 'broadcast', 'confirmed', 'failed', 'abandoned', 'superseded'] as const, 'status');
    if (q.alias) where.depositAddress = { alias: { contains: q.alias, mode: 'insensitive' } };
    if (q.addressId) where.depositAddressId = parseId(q.addressId, 'addressId');
    const [rows, total] = await Promise.all([
      this.prisma.sweep.findMany({ where, orderBy: page.orderBy, skip: page.skip, take: page.take, include: { depositAddress: { select: { alias: true, address: true } } } }),
      this.prisma.sweep.count({ where }),
    ]);
    return paginated(rows.map((s) => toSweepDto(this.cfg.network, s)), total, page);
  }

  async sweepDetail(id: bigint) {
    const row = await this.prisma.sweep.findUnique({
      where: { id },
      include: { depositAddress: { select: { alias: true, address: true } }, resourceOps: { orderBy: { createdAt: 'asc' } }, sweepDeposits: { include: { deposit: true } } },
    });
    if (!row) throw new NotFoundException('sweep not found');
    return {
      ...toSweepDto(this.cfg.network, row),
      resourceOperations: row.resourceOps.map(toResourceOpDto),
      deposits: row.sweepDeposits.map((sd) => toDepositDto(this.cfg.network, { ...sd.deposit, depositAddress: row.depositAddress })),
    };
  }

  async listResources(q: PageQuery & { kind?: string; status?: string; provider?: string; sweepId?: string }) {
    const page = parsePage(q, ['createdAt', 'updatedAt', 'costSun']);
    const where: Prisma.ResourceOperationWhereInput = {};
    if (q.kind) where.kind = parseEnum(q.kind, ['rent_energy', 'delegate_energy', 'undelegate_energy', 'activate', 'send_trx', 'rent_bandwidth'] as const, 'kind');
    if (q.status) where.status = parseEnum(q.status, ['requested', 'delivered', 'failed', 'reclaimed', 'expired'] as const, 'status');
    if (q.provider) where.provider = q.provider;
    if (q.sweepId) where.sweepId = parseId(q.sweepId, 'sweepId');
    const [rows, total] = await Promise.all([
      this.prisma.resourceOperation.findMany({ where, orderBy: page.orderBy, skip: page.skip, take: page.take }),
      this.prisma.resourceOperation.count({ where }),
    ]);
    return paginated(rows.map(toResourceOpDto), total, page);
  }

  async listAudit(q: PageQuery) {
    const page = parsePage(q, ['createdAt']);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ orderBy: page.orderBy, skip: page.skip, take: page.take }),
      this.prisma.auditLog.count(),
    ]);
    return paginated(rows.map(toAuditDto), total, page);
  }

  async recalculateBalances(): Promise<number> {
    const rows = await this.prisma.depositAddress.findMany({ where: { status: { in: ['assigned', 'suspended'] } }, select: { id: true } });
    for (const r of rows) await this.queues.enqueueRefreshBalance(r.id);
    return rows.length;
  }
}
