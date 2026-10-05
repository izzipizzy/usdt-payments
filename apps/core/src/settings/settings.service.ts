import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { AdminSettings, type AdminSettingsPatch } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Runtime-tunable settings: env gives defaults, the `settings` table overrides, cached for 10 s. */
@Injectable()
export class SettingsService {
  private cache: { value: AdminSettings; at: number } | null = null;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  defaults(): AdminSettings {
    return {
      sweepMinUsdt: this.cfg.SWEEP_MIN_USDT,
      sweepMaxAgeHours: this.cfg.SWEEP_MAX_AGE_HOURS,
      minDepositUsdt: this.cfg.MIN_DEPOSIT_USDT,
      feeLimitSun: this.cfg.FEE_LIMIT_SUN.toString(),
      energyMargin: this.cfg.ENERGY_MARGIN,
      energyDailyBudgetSun: this.cfg.ENERGY_DAILY_BUDGET_SUN.toString(),
      sweepMaxPerHour: this.cfg.SWEEP_MAX_PER_HOUR,
      providerOrder: this.cfg.providerOrder,
      burnEnabled: this.cfg.BURN_ENABLED,
      leaveDustOnAddress: this.cfg.LEAVE_DUST_ON_ADDRESS,
      itrxApiKey: this.cfg.ITRX_API_KEY ?? '',
      itrxApiSecret: this.cfg.ITRX_API_SECRET ?? '',
      itrxApiSecretSet: Boolean(this.cfg.ITRX_API_SECRET),
      itrxRentPeriod: this.cfg.ITRX_RENT_PERIOD,
      payoutMaxUsdt: '1000',
      payoutDailyMaxUsdt: '10000',
    };
  }

  /** Full settings including the itrx secret — for providers only, never for the API. */
  async raw(): Promise<AdminSettings> {
    return this.load();
  }

  /** Settings safe to return to clients: secret blanked, presence flag set. */
  async get(): Promise<AdminSettings> {
    const s = await this.load();
    return { ...s, itrxApiSecret: '', itrxApiSecretSet: s.itrxApiSecret.length > 0 };
  }

  private async load(): Promise<AdminSettings> {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const rows = await this.prisma.setting.findMany();
    const merged: Record<string, unknown> = { ...this.defaults() };
    for (const row of rows) merged[row.key] = row.value;
    const value = AdminSettings.parse(merged);
    this.cache = { value, at: Date.now() };
    return value;
  }

  async patch(patch: AdminSettingsPatch, actor: string): Promise<AdminSettings> {
    const clean: Record<string, unknown> = { ...patch };
    // An empty secret in a patch means "keep the stored one".
    if (clean.itrxApiSecret === '' || clean.itrxApiSecret === undefined) delete clean.itrxApiSecret;
    AdminSettings.parse({ ...(await this.load()), ...clean });
    await this.prisma.$transaction(
      Object.entries(clean).map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value: value as object, updatedBy: actor },
          update: { value: value as object, updatedBy: actor },
        }),
      ),
    );
    this.cache = null;
    return this.get();
  }

  invalidate(): void {
    this.cache = null;
  }
}

@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
