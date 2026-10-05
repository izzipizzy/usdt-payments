import { Inject, Injectable, Logger } from '@nestjs/common';
import { formatUsdt } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TronNodeClient } from '../tron/tron-node.client.js';
import { AuditService } from '../common/audit.service.js';
import { CollectorService } from '../signer/signer.client.js';

export interface ReconciliationReport {
  addressesChecked: number;
  mismatches: Array<{ address: string; alias: string | null; cached: string; onchain: string }>;
  collectorUsdt: string;
  totalOnAddresses: string;
}

/** Daily: Σ balanceOf(addresses) vs cached balances; log + audit any drift. */
@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly node: TronNodeClient,
    private readonly audit: AuditService,
    private readonly collectorSvc: CollectorService,
  ) {}

  async run(): Promise<ReconciliationReport> {
    const rows = await this.prisma.depositAddress.findMany({
      where: { OR: [{ status: 'assigned' }, { usdtBalanceCached: { gt: 0n } }, { status: 'suspended' }] },
      select: { id: true, address: true, alias: true, usdtBalanceCached: true },
    });
    const mismatches: ReconciliationReport['mismatches'] = [];
    let total = 0n;
    for (const r of rows) {
      try {
        const onchain = await this.node.usdtBalanceOf(r.address);
        total += onchain;
        if (onchain !== r.usdtBalanceCached) {
          mismatches.push({ address: r.address, alias: r.alias, cached: formatUsdt(r.usdtBalanceCached), onchain: formatUsdt(onchain) });
          await this.prisma.depositAddress.update({ where: { id: r.id }, data: { usdtBalanceCached: onchain, balanceCheckedAt: new Date() } });
        }
      } catch (e) {
        this.log.warn(`reconcile ${r.address}: ${(e as Error).message}`);
      }
    }
    const collectorAddress = await this.collectorSvc.get();
    const collector = collectorAddress ? await this.node.usdtBalanceOf(collectorAddress).catch(() => 0n) : 0n;
    const report: ReconciliationReport = { addressesChecked: rows.length, mismatches, collectorUsdt: formatUsdt(collector), totalOnAddresses: formatUsdt(total) };
    if (mismatches.length > 0) {
      this.log.warn(`reconciliation: ${mismatches.length} balance mismatches corrected`);
      await this.audit.record({ actor: 'system', action: 'reconciliation.mismatch', details: { mismatches: mismatches.slice(0, 100) } });
    } else {
      this.log.log(`reconciliation: ${rows.length} addresses, ${report.totalOnAddresses} USDT pending, collector ${report.collectorUsdt} USDT`);
    }
    return report;
  }
}
