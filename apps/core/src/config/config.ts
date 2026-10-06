import { createHash } from 'node:crypto';
import { base32Decode } from '../common/totp.js';
import { z } from 'zod';
import { EnergyProviderName, USDT_CONTRACT, isBase58Address, toHexAddress, type Network } from '@usdt-trx/shared';

/** Stable public id of a credential that reveals nothing about it (first 8 hex of sha256). */
export function credentialId(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 8);
}

/** Base32 that decodes to at least 80 bits: rejects padding-only / too-short "secrets" that would weaken the second factor. */
function isUsableTotpSecret(secret: string): boolean {
  try {
    return base32Decode(secret).length >= 10;
  } catch {
    return false;
  }
}

const zAddress = z.string().refine(isBase58Address, 'invalid TRON base58 address');
const csv = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  NETWORK: z.enum(['mainnet', 'nile']).default('nile'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  RUN_WORKERS: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  /** Simple mode: one password with full access. Login = password + TOTP code (ADMIN_TOTP_SECRET is mandatory). */
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters').optional(),
  /** Base32 TOTP secret for ADMIN_PASSWORD (generate with `pnpm --filter @usdt-trx/core totp:setup`). */
  ADMIN_TOTP_SECRET: z.string().regex(/^[A-Za-z2-7= -]{16,}$/, 'ADMIN_TOTP_SECRET must be base32 (16+ chars)').optional(),
  /**
   * Advanced: "token:role[:TOTPSECRET],...". With a TOTP secret the entry is a login credential (password + code →
   * session). Without one it is a machine token accepted directly as Bearer (for scripts); leave it out to force 2FA.
   */
  ADMIN_TOKENS: z.string().default(''),
  /** Admin session lifetime after login. */
  ADMIN_SESSION_TTL_MS: z.coerce.number().int().min(60_000).default(12 * 3_600_000),
  /** Step-up 2FA: money-moving admin actions (payouts, sweeps, staking, wallet, settings) need a fresh TOTP code. */
  ADMIN_TOTP_STEP_UP: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** Comma-separated IPs / CIDRs allowed to call the admin API (login included). Empty = any. */
  ADMIN_ALLOWED_IPS: z.string().default(''),
  /** First-run setup page password: YOU set it in .env (8+ chars) before opening the setup page; it is only used once. */
  SETUP_TOKEN: z.string().min(8, 'SETUP_TOKEN must be at least 8 characters').optional(),
  /**
   * How much of X-Forwarded-For to believe (audit IPs, rate limiting, ADMIN_ALLOWED_IPS): `false` (default), a hop
   * count (`1` = the address your own proxy appended), or a comma list of proxy IPs/CIDRs. `true` is refused.
   */
  TRUST_PROXY: z.string().default('false'),

  TRON_RPC_URLS: z.string().default('https://nile.trongrid.io'),
  TRONGRID_API_KEY: z.string().optional(),
  /** TronGrid account-history API for recovery scans; default follows NETWORK (api.trongrid.io / nile.trongrid.io). */
  TRONGRID_API_URL: z.string().url().optional(),
  TRON_HTTP_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  USDT_CONTRACT: zAddress.optional(),
  /** Optional external (cold) collector; default = main wallet derived from the phrase. */
  COLLECTOR_ADDRESS: zAddress.optional(),

  SIGNER_URL: z.string().url().default('http://127.0.0.1:3100'),
  SIGNER_TOKEN: z.string().min(1),
  WALLET_NAME: z.string().optional(),
  ADDRESS_POOL_SIZE: z.coerce.number().int().min(0).default(20),
  /** First derivation index used for deposit addresses. Set 1 when MAIN_WALLET_PATH (signer) is m/44'/195'/0'/0/0. */
  ADDRESS_START_INDEX: z.coerce.number().int().min(0).max(1000).default(0),

  ITRX_BASE_URL: z.string().url().default('https://itrx.io/api/v1/frontend/'),
  ITRX_API_KEY: z.string().optional(),
  ITRX_API_SECRET: z.string().optional(),
  ITRX_CALLBACK_URL: z.string().url().optional(),
  ITRX_MIN_BALANCE_SUN: z.coerce.bigint().default(50_000_000n),
  ITRX_RENT_PERIOD: z.enum(['1H', '1D']).default('1H'),
  /** itrx.io deposit address (from their dashboard). Set → the pool wallet tops the prepaid balance up automatically, only by what the next order needs. */
  ITRX_DEPOSIT_ADDRESS: zAddress.optional(),
  /** Extra sent on top of the exact shortfall so tiny price moves do not force a second top-up (default 2 TRX). */
  ITRX_TOPUP_RESERVE_SUN: z.coerce.bigint().default(2_000_000n),
  /** Never send less than this per top-up (default 10 TRX = itrx minimum deposit; smaller deposits are NOT credited). */
  ITRX_TOPUP_MIN_SUN: z.coerce.bigint().default(10_000_000n),
  /** Never send more than this per top-up (default 100 TRX; must not exceed the signer's POOL_MAX_TRUSTED_TRANSFER_SUN). */
  ITRX_TOPUP_MAX_SUN: z.coerce.bigint().default(100_000_000n),

  /** Own energy pool wallet (key lives in signer). */
  POOL_ADDRESS: zAddress.optional(),
  POOL_ACTIVATION_SUN: z.coerce.bigint().default(100_000n),
  POOL_BANDWIDTH_TOPUP_SUN: z.coerce.bigint().default(400_000n),

  BURN_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // sweep defaults (overridable from admin settings)
  SWEEP_MIN_USDT: z.string().default('20'),
  SWEEP_MAX_AGE_HOURS: z.coerce.number().int().default(72),
  MIN_DEPOSIT_USDT: z.string().default('0.01'),
  FEE_LIMIT_SUN: z.coerce.bigint().default(15_000_000n),
  ENERGY_MARGIN: z.coerce.number().default(1.1),
  ENERGY_DAILY_BUDGET_SUN: z.coerce.bigint().default(2_000_000_000n),
  SWEEP_MAX_PER_HOUR: z.coerce.number().int().default(200),
  PROVIDER_ORDER: z.string().default('itrx,own_pool,burn'),
  LEAVE_DUST_ON_ADDRESS: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  LARGE_DEPOSIT_USDT: z.string().default('5000'),

  /** Labels backup (address names, payout notes) rewritten on every change; keep it with the seed backup. */
  LABELS_FILE: z.string().optional(),

  WATCHER_START_BLOCK: z.coerce.number().int().optional(),
  WATCHER_BATCH_BLOCKS: z.coerce.number().int().default(20),
  WATCHER_POLL_MS: z.coerce.number().int().min(1000).default(15000),
  WATCHER_LAG_ALERT_BLOCKS: z.coerce.number().int().default(40),

  TX_TTL_MS: z.coerce.number().int().default(10 * 60_000),
  CONFIRM_TIMEOUT_MS: z.coerce.number().int().default(15 * 60_000),
  ENERGY_WAIT_MS: z.coerce.number().int().default(90_000),
  SWEEP_MAX_ATTEMPTS: z.coerce.number().int().default(4),
});

export type Env = z.infer<typeof EnvSchema>;

export type AdminRoleName = 'viewer' | 'operator' | 'admin';

export interface AdminCredential {
  /** Stable public id (sha256 prefix of the secret); shows up in audit rows and session records. */
  id: string;
  secret: string;
  role: AdminRoleName;
  /** Present → login credential (password + TOTP → session). Absent → machine token accepted as Bearer directly. */
  totpSecret?: string;
}

export interface AppConfig extends Env {
  network: Network;
  usdtContract: string;
  usdtContractHex: string;
  rpcUrls: string[];
  adminCredentials: AdminCredential[];
  adminAllowedIps: string[];
  /** Fastify `trustProxy` value derived from TRUST_PROXY. */
  trustProxy: boolean | number | string[];
  walletName: string;
  providerOrder: EnergyProviderName[];
}

/** `KEY=` in .env means "unset", not "empty string" (otherwise optional URL/address fields fail validation). */
function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(withoutEmpty(env));
  const usdt = parsed.USDT_CONTRACT ?? USDT_CONTRACT[parsed.NETWORK];
  const adminCredentials: AdminCredential[] = [];
  for (const entry of csv(parsed.ADMIN_TOKENS)) {
    const [token, role, totpSecret] = entry.split(':');
    if (!token || !['viewer', 'operator', 'admin'].includes(role ?? '')) throw new Error(`ADMIN_TOKENS entry malformed: ${entry.slice(0, 8)}…`);
    if (token.length < 12) throw new Error(`ADMIN_TOKENS: token for role ${role} is shorter than 12 characters`);
    if (totpSecret !== undefined && !isUsableTotpSecret(totpSecret)) throw new Error(`ADMIN_TOKENS: TOTP secret for role ${role} is not a usable base32 secret (≥ 80 bits)`);
    adminCredentials.push({ id: credentialId(token), secret: token, role: role as AdminRoleName, totpSecret });
  }
  if (parsed.ADMIN_TOTP_SECRET && !isUsableTotpSecret(parsed.ADMIN_TOTP_SECRET)) throw new Error('ADMIN_TOTP_SECRET is not a usable base32 secret (≥ 80 bits)');
  if (parsed.ADMIN_PASSWORD) {
    if (!parsed.ADMIN_TOTP_SECRET) {
      throw new Error('ADMIN_TOTP_SECRET is required with ADMIN_PASSWORD: admin login is password + TOTP code (run `pnpm --filter @usdt-trx/core totp:setup`)');
    }
    adminCredentials.push({ id: credentialId(parsed.ADMIN_PASSWORD), secret: parsed.ADMIN_PASSWORD, role: 'admin', totpSecret: parsed.ADMIN_TOTP_SECRET });
  }
  // No credentials at all is fine: Core starts in first-run setup mode and the admin UI shows the setup page.
  const tp = parsed.TRUST_PROXY.trim();
  if (tp === 'true') throw new Error('TRUST_PROXY=true trusts any X-Forwarded-For chain and is spoofable: use a hop count (1 for the bundled nginx) or a list of proxy IPs/CIDRs');
  const trustProxy: boolean | number | string[] = tp === 'false' || tp === '' || tp === '0' ? false : /^\d+$/.test(tp) ? Number(tp) : csv(tp);
  const adminAllowedIps = csv(parsed.ADMIN_ALLOWED_IPS);
  for (const cidr of adminAllowedIps) {
    if (!/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(cidr)) throw new Error(`ADMIN_ALLOWED_IPS entry malformed: ${cidr}`);
  }
  const rpcUrls = csv(parsed.TRON_RPC_URLS);
  if (parsed.NETWORK === 'mainnet' && rpcUrls.some((u) => /nile|shasta/i.test(u))) {
    throw new Error(`NETWORK=mainnet but TRON_RPC_URLS points at a testnet: ${rpcUrls.join(',')}`);
  }
  return {
    ...parsed,
    network: parsed.NETWORK,
    usdtContract: usdt,
    usdtContractHex: toHexAddress(usdt),
    rpcUrls,
    adminCredentials,
    adminAllowedIps,
    trustProxy,
    walletName: parsed.WALLET_NAME ?? `main-${parsed.NETWORK}`,
    providerOrder: EnergyProviderName.array().parse(csv(parsed.PROVIDER_ORDER)),
  };
}

export const CONFIG = Symbol('APP_CONFIG');
