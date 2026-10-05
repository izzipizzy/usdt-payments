import { z } from 'zod';
import { isBase58Address } from '../tron/address.js';

export const zTronAddress = z.string().refine(isBase58Address, 'invalid TRON base58 address');
export const zBigintString = z.string().regex(/^\d+$/, 'expected integer string');
export const zAlias = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'alias may contain letters, digits, . _ : -');

// ---- addresses / deposits / sweeps / payouts (admin API DTOs) ----
export const CreateAddressRequest = z.object({
  alias: zAlias,
  metadata: z.record(z.unknown()).optional(),
});
export type CreateAddressRequest = z.infer<typeof CreateAddressRequest>;

export const AddressDto = z.object({
  id: z.string(),
  alias: z.string().nullable(),
  address: zTronAddress,
  addressHex: z.string(),
  derivationIndex: z.number().int(),
  status: z.string(),
  onchainStatus: z.string(),
  usdtBalance: z.string(), // decimal string
  usdtBalanceRaw: zBigintString,
  balanceCheckedAt: z.string().nullable(),
  lastDepositAt: z.string().nullable(),
  createdAt: z.string(),
  explorerUrl: z.string(),
});
export type AddressDto = z.infer<typeof AddressDto>;

export const DepositDto = z.object({
  id: z.string(),
  alias: z.string().nullable(),
  address: z.string(),
  txId: z.string(),
  logIndex: z.number().int(),
  blockNumber: z.number().int(),
  fromAddress: z.string(),
  amount: z.string(),
  amountRaw: zBigintString,
  status: z.string(),
  confirmedAt: z.string().nullable(),
  creditedAt: z.string().nullable(),
  sweptAt: z.string().nullable(),
  sweepId: z.string().nullable(),
  rejectReason: z.string().nullable(),
  explorerUrl: z.string(),
});
export type DepositDto = z.infer<typeof DepositDto>;

export const SweepDto = z.object({
  id: z.string(),
  alias: z.string().nullable(),
  address: z.string(),
  collectorAddress: z.string(),
  amount: z.string(),
  amountRaw: zBigintString,
  status: z.string(),
  energySource: z.string(),
  energyEstimated: z.number().int().nullable(),
  energyUsed: z.number().int().nullable(),
  bandwidthUsed: z.number().int().nullable(),
  trxFeeBurnedSun: zBigintString.nullable(),
  resourceCostSun: zBigintString.nullable(),
  txId: z.string().nullable(),
  attempt: z.number().int(),
  lastError: z.string().nullable(),
  broadcastAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  explorerUrl: z.string().nullable(),
});
export type SweepDto = z.infer<typeof SweepDto>;

export const zUsdtAmount = z.string().regex(/^\d+(\.\d{1,6})?$/, 'amount as decimal string with up to 6 decimals');

export const CreatePayoutRequest = z.object({
  /** Idempotency key (the UI generates one); repeating it returns the same payout instead of paying twice. */
  externalId: z.string().min(1).max(128),
  to: zTronAddress,
  amount: zUsdtAmount,
  note: z.string().max(500).optional(),
});
export type CreatePayoutRequest = z.infer<typeof CreatePayoutRequest>;

export const PayoutDto = z.object({
  id: z.string(),
  externalId: z.string(),
  fromAddress: z.string(),
  /** One-time hop address the payout goes through (null until derived). */
  viaAddress: z.string().nullable(),
  toAddress: z.string(),
  /** 1 = main → hop in progress, 2 = hop → recipient in progress / done. */
  stage: z.number().int(),
  hop1TxId: z.string().nullable(),
  hop1ExplorerUrl: z.string().nullable(),
  amount: z.string(),
  amountRaw: zBigintString,
  note: z.string().nullable(),
  status: z.string(),
  energySource: z.string(),
  energyUsed: z.number().int().nullable(),
  resourceCostSun: zBigintString.nullable(),
  txId: z.string().nullable(),
  attempt: z.number().int(),
  lastError: z.string().nullable(),
  createdBy: z.string(),
  broadcastAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  explorerUrl: z.string().nullable(),
});
export type PayoutDto = z.infer<typeof PayoutDto>;

// ---- signer API ----
export const TronTxJson = z.object({
  visible: z.boolean().optional(),
  txID: z.string().regex(/^[0-9a-f]{64}$/),
  raw_data: z.record(z.unknown()),
  raw_data_hex: z.string().regex(/^[0-9a-f]+$/),
  signature: z.array(z.string()).optional(),
});
export type TronTxJson = z.infer<typeof TronTxJson>;

export const DeriveRequest = z.object({ index: z.number().int().min(0).max(2 ** 31 - 1) });
export const DeriveResponse = z.object({
  index: z.number().int(),
  address: zTronAddress,
  addressHex: z.string(),
  publicKey: z.string(), // compressed hex
});
export type DeriveResponse = z.infer<typeof DeriveResponse>;

export const XpubResponse = z.object({ xpub: z.string(), path: z.string(), network: z.string() });

export const SignSweepRequest = z.object({
  index: z.number().int().min(0),
  transaction: TronTxJson,
  /** Optional correlation id, logged only. */
  sweepId: z.string().optional(),
});
export type SignSweepRequest = z.infer<typeof SignSweepRequest>;

export const SignPoolRequest = z.object({ transaction: TronTxJson, purpose: z.string().optional() });
export type SignPoolRequest = z.infer<typeof SignPoolRequest>;

export const SignResponse = z.object({ txID: z.string(), signature: z.string() });
export type SignResponse = z.infer<typeof SignResponse>;

// ---- admin API ----
export const EnergyProviderName = z.enum(['itrx', 'own_pool', 'burn']);
export type EnergyProviderName = z.infer<typeof EnergyProviderName>;

export const AdminSettings = z.object({
  sweepMinUsdt: zUsdtAmount,
  sweepMaxAgeHours: z.number().int().min(1).max(24 * 365),
  minDepositUsdt: zUsdtAmount,
  feeLimitSun: zBigintString,
  energyMargin: z.number().min(1).max(3),
  energyDailyBudgetSun: zBigintString,
  sweepMaxPerHour: z.number().int().min(0).max(100_000),
  providerOrder: z.array(EnergyProviderName).max(3),
  burnEnabled: z.boolean(),
  leaveDustOnAddress: z.boolean(),
  /** itrx.io energy rental credentials. The secret is never returned; `itrxApiSecretSet` tells whether one is stored. */
  itrxApiKey: z.string().default(''),
  itrxApiSecret: z.string().default(''),
  itrxApiSecretSet: z.boolean().default(false),
  itrxRentPeriod: z.enum(['1H', '1D']).default('1H'),
  /** Payout limits (decimal USDT). 0 = no limit. */
  payoutMaxUsdt: zUsdtAmount.default('1000'),
  payoutDailyMaxUsdt: zUsdtAmount.default('10000'),
});
export type AdminSettings = z.infer<typeof AdminSettings>;

export const AdminSettingsPatch = AdminSettings.omit({ itrxApiSecretSet: true }).partial();

export const ProviderTestResult = z.object({
  ok: z.boolean(),
  provider: z.string(),
  detail: z.string(),
  unitPriceSun: z.number().nullable(),
  transferCostTrx: z.string().nullable(),
  balanceTrx: z.string().nullable(),
});
export type ProviderTestResult = z.infer<typeof ProviderTestResult>;
export type AdminSettingsPatch = z.infer<typeof AdminSettingsPatch>;

export const DashboardDto = z.object({
  network: z.string(),
  collector: z.object({ address: z.string(), usdtBalance: z.string(), trxBalance: z.string(), explorerUrl: z.string() }),
  addresses: z.object({ total: z.number(), assigned: z.number(), withBalance: z.number(), usdtTotal: z.string() }),
  watcher: z.object({ solidBlock: z.number().nullable(), cursorBlock: z.number().nullable(), lagBlocks: z.number().nullable(), updatedAt: z.string().nullable() }),
  sweeps24h: z.object({ count: z.number(), confirmed: z.number(), failed: z.number(), costSun: zBigintString, costTrx: z.string() }),
  queues: z.array(z.object({ name: z.string(), waiting: z.number(), active: z.number(), failed: z.number(), delayed: z.number() })),
  providers: z.array(z.object({ name: z.string(), healthy: z.boolean(), balanceSun: zBigintString.nullable(), detail: z.string().nullable() })),
  chainParams: z.object({ energyFeeSun: z.number().nullable(), bandwidthFeeSun: z.number().nullable(), createAccountFeeSun: z.number().nullable() }),
});
export type DashboardDto = z.infer<typeof DashboardDto>;

export const ResourceOpDto = z.object({
  id: z.string(),
  sweepId: z.string().nullable(),
  targetAddress: z.string(),
  kind: z.string(),
  provider: z.string(),
  externalOrderId: z.string().nullable(),
  energyAmount: z.number().int().nullable(),
  bandwidthAmount: z.number().int().nullable(),
  costSun: zBigintString.nullable(),
  status: z.string(),
  txId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ResourceOpDto = z.infer<typeof ResourceOpDto>;

export const AuditDto = z.object({
  id: z.string(),
  actor: z.string(),
  role: z.string().nullable(),
  action: z.string(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  details: z.record(z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditDto = z.infer<typeof AuditDto>;

export const ProviderDto = z.object({
  name: z.string(),
  healthy: z.boolean(),
  balanceSun: zBigintString.nullable(),
  detail: z.string().nullable(),
  enabled: z.boolean(),
});
export type ProviderDto = z.infer<typeof ProviderDto>;

export const QueueStatsDto = z.object({
  name: z.string(),
  waiting: z.number(),
  active: z.number(),
  failed: z.number(),
  delayed: z.number(),
  completed: z.number(),
});
export type QueueStatsDto = z.infer<typeof QueueStatsDto>;

export const AdminRole = z.enum(['viewer', 'operator', 'admin']);
export type AdminRole = z.infer<typeof AdminRole>;

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
