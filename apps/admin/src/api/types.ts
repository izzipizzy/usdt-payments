import type {
  AddressDto,
  AdminRole,
  DepositDto,
  PayoutDto,
  ResourceOpDto,
  SweepDto,
} from '@usdt-trx/shared';

export type {
  AddressDto,
  AdminRole,
  AdminSettings,
  AdminSettingsPatch,
  AuditDto,
  CreatePayoutRequest,
  DashboardDto,
  DepositDto,
  PayoutDto,
  ProviderDto,
  QueueStatsDto,
  ResourceOpDto,
  SweepDto,
} from '@usdt-trx/shared';

export interface Me {
  role: AdminRole;
  network: string;
  /** External cold collector, `null` when sweeps go to the main wallet. */
  collectorAddress: string | null;
  explorerBase: string;
  /** Money-moving actions need a fresh authenticator code (ADMIN_TOTP_STEP_UP on the server). */
  totpStepUp: boolean;
  authKind: 'session' | 'machine';
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type AddressShowDto = AddressDto & { deposits: DepositDto[]; sweeps: SweepDto[] };
export type SweepShowDto = SweepDto & { resourceOperations: ResourceOpDto[]; deposits: DepositDto[] };
export type PayoutShowDto = PayoutDto & { resourceOperations: ResourceOpDto[] };
/** POST /admin/v1/payouts response: `created` is false when `externalId` already existed. */
export type PayoutCreateResult = PayoutDto & { created: boolean };

/** NestJS default error body. */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

/** GET /admin/v1/pool. When `configured` is false only `reason` accompanies it. */
export interface PoolConfiguredDto {
  configured: true;
  address: string;
  explorerUrl: string;
  trxBalance: string;
  trxBalanceSun: string;
  energyLimit: number;
  energyUsed: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  stakedForEnergyTrx: string;
  stakedForBandwidthTrx: string;
  delegatedOutEnergyTrx: string;
  energyPerTrxPerDay: number;
  estimatedSweepsPerDay: number;
}
export interface PoolUnconfiguredDto {
  configured: false;
  reason?: string;
}
export type PoolDto = PoolConfiguredDto | PoolUnconfiguredDto;

export type PoolResource = 'ENERGY' | 'BANDWIDTH';
export interface PoolStakeBody {
  amountTrx: string;
  resource: PoolResource;
}
/** POST /admin/v1/pool/stake | /unstake response. */
export interface PoolTxResult {
  txId: string;
  explorerUrl: string;
}

/** Fee-paying service wallet (derived from the same seed); holds TRX only. */
export interface WalletPoolDto {
  address: string;
  explorerUrl: string;
  trxBalance: string;
  energyAvailable: number;
  activated: boolean;
  minTrx: string;
  lowBalance: boolean;
}
/** Main wallet (derived from the same seed): holds the whole USDT balance, receives sweeps (unless an external cold collector is set) and sends payouts. */
export interface WalletMainDto {
  address: string;
  explorerUrl: string;
  usdtBalance: string;
  trxBalance: string;
  activated: boolean;
  /** `true` when sweeps land here (no external collector configured). */
  isCollector: boolean;
}
/** @deprecated Same address as `main`; kept for compatibility with older Core. */
export type WalletPayoutDto = Omit<WalletMainDto, 'isCollector'>;
/** GET /admin/v1/wallet. */
export interface WalletStatusDto {
  initialized: boolean;
  network: 'nile' | 'mainnet';
  xpub: string | null;
  addressesIssued: number;
  /** Where sweeps go: the main wallet, or an external cold address when `collectorExternal` is `true`; `null` until initialised. */
  collectorAddress: string | null;
  collectorUsdt: string;
  /** `true` only when an external cold collector is configured in `.env`. */
  collectorExternal: boolean;
  explorerBase: string;
  /** `null` until the wallet is initialised. */
  pool: WalletPoolDto | null;
  /** `null` until the wallet is initialised (absent on older Core). */
  main?: WalletMainDto | null;
  /** @deprecated Same address as `main`; kept for compatibility. */
  payout?: WalletPayoutDto | null;
}
export type MnemonicWords = 12 | 24;
/** POST /admin/v1/wallet/create body. */
export interface WalletCreateBody {
  words: MnemonicWords;
}
/** POST /admin/v1/wallet/create response — the phrase is returned exactly once. */
export interface WalletCreateResult {
  mnemonic: string;
  xpub: string;
  firstAddress: string;
}
/** POST /admin/v1/wallet/import body / response. */
export interface WalletImportBody {
  mnemonic: string;
}
export interface WalletImportResult {
  xpub: string;
  firstAddress: string;
}

/** GET /admin/v1/recovery/status */
export interface RecoveryStatusDto {
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
