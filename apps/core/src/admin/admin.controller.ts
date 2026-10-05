import { BadRequestException, Body, Controller, Get, Header, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminSettingsPatch, CreateAddressRequest, CreatePayoutRequest } from '@usdt-trx/shared';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../config/config.js';
import { Admin, AdminGuard, RequireRole, RequireStepUp, type AdminPrincipal } from '../common/auth.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { explorerBase } from '../common/explorer.js';
import { parseId } from '../common/ids.js';
import { AuditService } from '../common/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { Queues } from '../infra/queues.js';
import { AddressesService } from '../addresses/addresses.service.js';
import { toAddressDto, toPayoutDto, toSweepDto } from '../addresses/mappers.js';
import { PayoutsService } from '../payouts/payouts.service.js';
import { CollectorService } from '../signer/signer.client.js';
import { SweepPlannerService } from '../sweeps/sweep-planner.service.js';
import { SweepLifecycleService } from '../sweeps/sweep-lifecycle.service.js';
import { EnergyManagerService } from '../energy/energy-manager.service.js';
import { PoolService } from '../energy/pool.service.js';
import { ItrxProvider } from '../energy/itrx.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminService } from './admin.service.js';
import { WalletService } from './wallet.service.js';
import { LabelsFile, LabelsService } from '../backup/labels.service.js';
import { RecoveryService } from '../maintenance/recovery.service.js';

const Reason = z.object({ reason: z.string().max(500).optional() }).default({});
const WalletCreateBody = z.object({ words: z.union([z.literal(12), z.literal(24)]).default(12) });
const WalletImportBody = z.object({ mnemonic: z.string().min(20).max(1000) });
const StakeBody = z.object({ amountTrx: z.string().regex(/^\d+(\.\d{1,6})?$/), resource: z.enum(['ENERGY', 'BANDWIDTH']).default('ENERGY') });

@Controller('admin/v1')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly admin: AdminService,
    private readonly wallet: WalletService,
    private readonly addresses: AddressesService,
    private readonly planner: SweepPlannerService,
    private readonly lifecycle: SweepLifecycleService,
    private readonly energy: EnergyManagerService,
    private readonly pool: PoolService,
    private readonly itrx: ItrxProvider,
    private readonly payouts: PayoutsService,
    private readonly collector: CollectorService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly queues: Queues,
    private readonly prisma: PrismaService,
    private readonly labels: LabelsService,
    private readonly recovery: RecoveryService,
  ) {}

  @Get('me')
  async me(@Admin() admin: AdminPrincipal) {
    return {
      role: admin.role,
      network: this.cfg.network,
      collectorAddress: await this.collector.get(),
      explorerBase: explorerBase(this.cfg.network),
      /** UI must ask for a fresh TOTP code before money-moving actions. */
      totpStepUp: this.cfg.ADMIN_TOTP_STEP_UP,
      authKind: admin.kind,
    };
  }

  // ---- wallet (simple mode)
  @Get('wallet')
  walletStatus() {
    return this.wallet.status();
  }

  @Post('wallet/create')
  @RequireRole('admin')
  @RequireStepUp()
  @HttpCode(200)
  walletCreate(@Body(new ZodPipe(WalletCreateBody)) body: { words: 12 | 24 }, @Admin() admin: AdminPrincipal) {
    return this.wallet.create(body.words, admin.actor, admin.ip);
  }

  @Post('wallet/import')
  @RequireRole('admin')
  @RequireStepUp()
  @HttpCode(200)
  walletImport(@Body(new ZodPipe(WalletImportBody)) body: { mnemonic: string }, @Admin() admin: AdminPrincipal) {
    return this.wallet.import(body.mnemonic, admin.actor, admin.ip);
  }

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  // ---- addresses
  @Get('addresses')
  listAddresses(@Query() q: Record<string, string>) {
    return this.admin.listAddresses(q);
  }

  @Post('addresses')
  @RequireRole('operator')
  @HttpCode(200)
  async createAddress(@Body(new ZodPipe(CreateAddressRequest)) body: CreateAddressRequest, @Admin() admin: AdminPrincipal) {
    const { address, created } = await this.addresses.create(body, admin.actor);
    return { ...toAddressDto(this.cfg.network, address), created };
  }

  @Get('addresses/:id')
  addressDetail(@Param('id') id: string) {
    return this.admin.addressDetail(parseId(id));
  }

  @Post('addresses/:id/sweep')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  async sweepNow(@Param('id') id: string, @Admin() admin: AdminPrincipal) {
    const sweepId = await this.planner.forceSweep(parseId(id), admin.actor);
    await this.audit.record({ actor: admin.actor, role: admin.role, action: 'address.sweep_now', subjectType: 'address', subjectId: id, ip: admin.ip });
    return { sweepId: sweepId.toString() };
  }

  @Post('addresses/:id/suspend')
  @RequireRole('operator')
  @HttpCode(200)
  async suspend(@Param('id') id: string, @Body(new ZodPipe(Reason)) body: { reason?: string }, @Admin() admin: AdminPrincipal) {
    return toAddressDto(this.cfg.network, await this.addresses.suspend(parseId(id), body?.reason, admin.actor, admin.ip));
  }

  @Post('addresses/:id/resume')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  async resume(@Param('id') id: string, @Admin() admin: AdminPrincipal) {
    return toAddressDto(this.cfg.network, await this.addresses.resume(parseId(id), admin.actor, admin.ip));
  }

  @Post('addresses/:id/refresh-balance')
  @RequireRole('operator')
  @HttpCode(200)
  async refreshBalance(@Param('id') id: string) {
    return toAddressDto(this.cfg.network, await this.addresses.refreshFromChain(parseId(id)));
  }

  // ---- deposits
  @Get('deposits')
  listDeposits(@Query() q: Record<string, string>) {
    return this.admin.listDeposits(q);
  }


  // ---- sweeps
  @Get('sweeps')
  listSweeps(@Query() q: Record<string, string>) {
    return this.admin.listSweeps(q);
  }

  @Post('sweeps/sweep-all')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  async sweepAll(@Admin() admin: AdminPrincipal) {
    const planned = await this.planner.sweepAll(admin.actor);
    await this.audit.record({ actor: admin.actor, role: admin.role, action: 'sweep.sweep_all', details: { queued: planned }, ip: admin.ip });
    return { planned };
  }

  @Get('sweeps/:id')
  sweepDetail(@Param('id') id: string) {
    return this.admin.sweepDetail(parseId(id));
  }

  @Post('sweeps/:id/retry')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  async retry(@Param('id') id: string, @Admin() admin: AdminPrincipal) {
    return toSweepDto(this.cfg.network, await this.lifecycle.retry(parseId(id), admin.actor));
  }

  @Post('sweeps/:id/cancel')
  @RequireRole('operator')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body(new ZodPipe(Reason)) body: { reason?: string }, @Admin() admin: AdminPrincipal) {
    return toSweepDto(this.cfg.network, await this.lifecycle.cancel(parseId(id), admin.actor, body?.reason, admin.ip));
  }

  @Post('sweeps/:id/rebuild')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  async rebuild(@Param('id') id: string, @Admin() admin: AdminPrincipal) {
    return toSweepDto(this.cfg.network, await this.lifecycle.rebuild(parseId(id), admin.actor, admin.ip));
  }

  // ---- payouts
  @Get('payouts')
  async listPayouts(@Query() q: Record<string, string>) {
    const page = await this.payouts.list(q);
    return { ...page, items: page.items.map((p) => toPayoutDto(this.cfg.network, p)) };
  }

  @Post('payouts')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  async createPayout(@Body(new ZodPipe(CreatePayoutRequest)) body: CreatePayoutRequest, @Admin() admin: AdminPrincipal) {
    const { payout, created } = await this.payouts.create(body, admin.actor, admin.ip);
    return { ...toPayoutDto(this.cfg.network, payout), created };
  }

  @Get('payouts/:id')
  async payoutDetail(@Param('id') id: string) {
    const p = await this.payouts.get(parseId(id));
    const ops = await this.prisma.resourceOperation.findMany({ where: { payoutId: p.id }, orderBy: { createdAt: 'asc' } });
    const { toResourceOpDto } = await import('../addresses/mappers.js');
    return { ...toPayoutDto(this.cfg.network, p), resourceOperations: ops.map(toResourceOpDto) };
  }

  @Post('payouts/:id/retry')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  async retryPayout(@Param('id') id: string, @Admin() admin: AdminPrincipal) {
    return toPayoutDto(this.cfg.network, await this.payouts.retry(parseId(id), admin.actor, 0, admin.ip));
  }

  @Post('payouts/:id/cancel')
  @RequireRole('operator')
  @HttpCode(200)
  async cancelPayout(@Param('id') id: string, @Body(new ZodPipe(Reason)) body: { reason?: string }, @Admin() admin: AdminPrincipal) {
    return toPayoutDto(this.cfg.network, await this.payouts.cancel(parseId(id), admin.actor, body?.reason, admin.ip));
  }

  // ---- balances / resources / providers / queues
  @Post('balances/recalculate')
  @RequireRole('operator')
  @HttpCode(200)
  async recalc(@Admin() admin: AdminPrincipal) {
    const queued = await this.admin.recalculateBalances();
    await this.audit.record({ actor: admin.actor, role: admin.role, action: 'balances.recalculate', details: { queued }, ip: admin.ip });
    return { queued };
  }

  @Get('resources')
  listResources(@Query() q: Record<string, string>) {
    return this.admin.listResources(q);
  }

  @Get('providers')
  providers() {
    return this.energy.providersStatus();
  }

  @Post('providers/itrx/test')
  @RequireRole('operator')
  @HttpCode(200)
  async testItrx() {
    const r = await this.itrx.test();
    return { provider: 'itrx', ...r };
  }

  // ---- energy pool
  @Get('pool')
  poolStatus() {
    return this.pool.status();
  }

  @Post('pool/stake')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  stake(@Body(new ZodPipe(StakeBody)) body: { amountTrx: string; resource: 'ENERGY' | 'BANDWIDTH' }, @Admin() admin: AdminPrincipal) {
    return this.pool.stake(body.amountTrx, body.resource, admin.actor, admin.ip);
  }

  @Post('pool/unstake')
  @RequireRole('operator')
  @RequireStepUp()
  @HttpCode(200)
  unstake(@Body(new ZodPipe(StakeBody)) body: { amountTrx: string; resource: 'ENERGY' | 'BANDWIDTH' }, @Admin() admin: AdminPrincipal) {
    return this.pool.unstake(body.amountTrx, body.resource, admin.actor, admin.ip);
  }

  @Get('queues')
  queueStats() {
    return this.queues.stats();
  }

  // ---- backup (labels) / recovery from chain
  @Get('backup/labels')
  backupLabels() {
    return this.labels.snapshot();
  }

  @Get('backup/labels.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  backupLabelsCsv() {
    return this.labels.csv();
  }

  @Post('backup/labels')
  @RequireRole('admin')
  @HttpCode(200)
  async restoreLabels(@Body() body: unknown, @Admin() admin: AdminPrincipal) {
    const parsed = LabelsFile.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: 'not a labels backup file', issues: parsed.error.issues.slice(0, 5) });
    const res = await this.labels.apply(parsed.data).catch((e: Error) => {
      throw new BadRequestException(e.message);
    });
    await this.audit.record({ actor: admin.actor, role: admin.role, action: 'backup.labels_restore', details: { applied: res.applied, skipped: res.skipped.length }, ip: admin.ip });
    return res;
  }

  @Post('recovery/scan')
  @RequireRole('admin')
  @RequireStepUp()
  @HttpCode(200)
  async recoveryScan(@Admin() admin: AdminPrincipal) {
    const queued = await this.recovery.enqueue(admin.actor);
    await this.audit.record({ actor: admin.actor, role: admin.role, action: 'recovery.scan_requested', details: { queued }, ip: admin.ip });
    return { queued };
  }

  @Get('recovery/status')
  recoveryStatus() {
    return this.recovery.status();
  }

  // ---- settings / audit
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  @RequireRole('admin')
  @RequireStepUp()
  async patchSettings(@Body(new ZodPipe(AdminSettingsPatch)) body: Record<string, unknown>, @Admin() admin: AdminPrincipal) {
    const next = await this.settings.patch(body, admin.actor);
    // Record which keys changed, never the values of credentials (AuditService redacts as a second line of defence).
    const details = { ...body, itrxApiSecret: body.itrxApiSecret ? '[changed]' : undefined, itrxApiKey: body.itrxApiKey ? '[changed]' : undefined };
    await this.audit.record({ actor: admin.actor, role: admin.role, action: 'settings.patch', details, ip: admin.ip });
    return next;
  }

  @Get('audit')
  listAudit(@Query() q: Record<string, string>) {
    return this.admin.listAudit(q);
  }
}
