import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { formatUsdt, isBase58Address, parseUsdt } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const address = z.string().refine(isBase58Address, 'invalid TRON address');
export const LabelsFile = z.object({
  version: z.literal(1),
  network: z.enum(['mainnet', 'nile']),
  xpub: z.string().nullable(),
  exportedAt: z.string().optional(),
  addresses: z.array(z.object({
    index: z.number().int().nonnegative(),
    address,
    alias: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    suspended: z.boolean().default(false),
    suspendReason: z.string().nullable().optional(),
  })),
  payouts: z.array(z.object({
    externalId: z.string(),
    to: address,
    amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    note: z.string().nullable().optional(),
    createdAt: z.string(),
  })).default([]),
});
export type LabelsFile = z.infer<typeof LabelsFile>;

@Injectable()
export class LabelsService implements OnModuleDestroy {
  private readonly log = new Logger(LabelsService.name);
  private pending: Promise<void> = Promise.resolve();

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async snapshot(): Promise<LabelsFile> {
    const wallet = await this.prisma.wallet.findUnique({ where: { name: this.cfg.walletName } });
    const [addresses, payouts] = await Promise.all([
      wallet ? this.prisma.depositAddress.findMany({ where: { walletId: wallet.id }, orderBy: { derivationIndex: 'asc' } }) : [],
      this.prisma.payout.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);
    return LabelsFile.parse({
      version: 1, network: this.cfg.network, xpub: wallet?.xpub ?? null, exportedAt: new Date().toISOString(),
      addresses: addresses.map((a) => ({ index: a.derivationIndex, address: a.address, alias: a.alias, metadata: a.metadata, suspended: a.status === 'suspended', suspendReason: a.suspendReason })),
      payouts: payouts.map((p) => ({ externalId: p.externalId, to: p.toAddress, amount: formatUsdt(p.amount), note: p.note, createdAt: p.createdAt.toISOString() })),
    });
  }

  readFile(): LabelsFile | null {
    const path = this.cfg.LABELS_FILE;
    if (!path || !existsSync(path)) return null;
    const backup = LabelsFile.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (backup.network !== this.cfg.network) throw new Error('labels backup belongs to another network');
    return backup;
  }

  scheduleWrite(): void {
    const path = this.cfg.LABELS_FILE;
    if (!path) return;
    // Serialize writes and replace atomically so a crash cannot leave partial JSON.
    this.pending = this.pending.then(async () => {
      const snapshot = await this.snapshot();
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, path);
    }).catch((e: Error) => this.log.error(`labels backup failed: ${e.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pending;
  }

  async apply(input: LabelsFile): Promise<{ applied: number; skipped: string[] }> {
    const backup = LabelsFile.parse(input);
    if (backup.network !== this.cfg.network) throw new Error('labels backup belongs to another network');
    const wallet = await this.prisma.wallet.findUnique({ where: { name: this.cfg.walletName } });
    if (!wallet || wallet.xpub !== backup.xpub) throw new Error('labels backup belongs to another wallet');
    const result = await this.prisma.$transaction(async (tx) => {
      let applied = 0;
      const skipped: string[] = [];
      for (const label of backup.addresses) {
        const row = await tx.depositAddress.findUnique({ where: { address: label.address } });
        if (!row || row.walletId !== wallet.id || row.derivationIndex !== label.index) {
          skipped.push(label.address);
          continue;
        }
        await tx.depositAddress.update({ where: { id: row.id }, data: {
          alias: label.alias,
          metadata: label.metadata === null ? Prisma.DbNull : label.metadata as Prisma.InputJsonObject | undefined,
          status: row.status === 'retired' ? 'retired' : label.suspended ? 'suspended' : row.status === 'suspended' ? 'assigned' : row.status,
          suspendReason: label.suspended ? label.suspendReason : null,
        } });
        applied++;
      }
      for (const label of backup.payouts) {
        const row = await tx.payout.findUnique({ where: { externalId: label.externalId } });
        if (!row || row.toAddress !== label.to || row.amount !== parseUsdt(label.amount)) {
          skipped.push(label.externalId);
          continue;
        }
        await tx.payout.update({ where: { id: row.id }, data: { note: label.note } });
        applied++;
      }
      return { applied, skipped };
    });
    this.scheduleWrite();
    return result;
  }

  async csv(): Promise<string> {
    const backup = await this.snapshot();
    const cell = (value: unknown): string => {
      let text = value === null || value === undefined ? '' : String(value);
      if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows: unknown[][] = [['kind', 'index', 'address', 'alias', 'metadata', 'suspended', 'suspendReason', 'externalId', 'amount', 'note', 'createdAt']];
    for (const a of backup.addresses) rows.push(['address', a.index, a.address, a.alias, JSON.stringify(a.metadata), a.suspended, a.suspendReason]);
    for (const p of backup.payouts) rows.push(['payout', '', p.to, '', '', '', '', p.externalId, p.amount, p.note, p.createdAt]);
    return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
}

@Global()
@Module({ providers: [LabelsService], exports: [LabelsService] })
export class BackupModule {}
