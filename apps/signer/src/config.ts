import { z } from 'zod';
import { USDT_CONTRACT, isBase58Address, toHexAddress } from '@usdt-trx/shared';

const zAddress = z.string().refine(isBase58Address, 'invalid TRON base58 address');

const EnvSchema = z
  .object({
    NETWORK: z.enum(['mainnet', 'nile']).default('nile'),
    SIGNER_HOST: z.string().default('127.0.0.1'),
    SIGNER_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    /** Bearer token that core must present. Required. */
    SIGNER_TOKEN: z.string().min(32, 'SIGNER_TOKEN must be at least 32 chars'),

    /** Where the master seed comes from. */
    SEED_SOURCE: z.enum(['file', 'env']).default('file'),
    SEED_FILE: z.string().default('./secrets/seed.enc.json'),
    SEED_PASSPHRASE: z.string().optional(),
    SEED_PASSPHRASE_FILE: z.string().optional(),
    /** Dev/Nile only: raw hex seed (32-64 bytes). Refused on mainnet. */
    SEED_HEX: z.string().regex(/^[0-9a-fA-F]{64,128}$/).optional(),

    /**
     * Derivation path of the MAIN wallet (holds the USDT, receives sweeps, sends payouts). Default account 2.
     * Set m/44'/195'/0'/0/0 to make the address your wallet app (TronLink) shows for the phrase the main wallet —
     * then also set ADDRESS_START_INDEX=1 in core so deposit addresses skip it.
     */
    MAIN_WALLET_PATH: z.string().regex(/^m(\/\d+'?)+$/).default("m/44'/195'/2'/0/0"),
    /** Derivation path of the fee-paying pool wallet. Default account 1. */
    POOL_WALLET_PATH: z.string().regex(/^m(\/\d+'?)+$/).default("m/44'/195'/1'/0/0"),
    /** Optional external (cold) collector. When unset, sweeps go to the main wallet derived from the phrase. */
    COLLECTOR_ADDRESS: zAddress.optional(),
    USDT_CONTRACT: zAddress.optional(),
    MAX_FEE_LIMIT_SUN: z.coerce.bigint().default(30_000_000n),
    MAX_EXPIRATION_MS: z.coerce.number().int().default(15 * 60_000),
    /** Sweep amount ceiling per transaction; 0 disables the check. */
    MAX_SWEEP_AMOUNT_RAW: z.coerce.bigint().default(0n),
    /** Payout ceiling per transaction in raw USDT (10^-6); default 10 000 USDT. 0 disables the check. */
    MAX_PAYOUT_RAW: z.coerce.bigint().default(10_000_000_000n),

    /** Optional energy-pool key (separate from the seed). */
    POOL_KEY_SOURCE: z.enum(['file', 'env', 'none']).default('none'),
    POOL_KEY_FILE: z.string().default('./secrets/pool.enc.json'),
    POOL_KEY_PASSPHRASE: z.string().optional(),
    POOL_KEY_PASSPHRASE_FILE: z.string().optional(),
    POOL_KEY_HEX: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
    POOL_MAX_TRANSFER_SUN: z.coerce.bigint().default(2_000_000n),
    /** Addresses the pool may pay MORE than POOL_MAX_TRANSFER_SUN to (e.g. the itrx.io deposit address), comma separated. */
    POOL_TRUSTED_RECIPIENTS: z.string().default(''),
    /** Per-transaction ceiling for transfers to POOL_TRUSTED_RECIPIENTS; default 100 TRX. */
    POOL_MAX_TRUSTED_TRANSFER_SUN: z.coerce.bigint().default(100_000_000n),
    POOL_MAX_DELEGATE_SUN: z.coerce.bigint().default(200_000_000_000n),

    AUDIT_LOG_PATH: z.string().default('./signer-audit.log'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(600),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NETWORK === 'mainnet' && env.SEED_SOURCE === 'env') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SEED_SOURCE=env is not allowed on mainnet' });
    }
    if (env.SEED_SOURCE === 'env' && !env.SEED_HEX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SEED_HEX required when SEED_SOURCE=env' });
    }
    if (env.SEED_SOURCE === 'file' && !env.SEED_PASSPHRASE && !env.SEED_PASSPHRASE_FILE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SEED_PASSPHRASE or SEED_PASSPHRASE_FILE required' });
    }
    if (env.POOL_KEY_SOURCE === 'env' && !env.POOL_KEY_HEX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'POOL_KEY_HEX required when POOL_KEY_SOURCE=env' });
    }
    if (env.POOL_KEY_SOURCE === 'env' && env.NETWORK === 'mainnet') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'POOL_KEY_SOURCE=env is not allowed on mainnet' });
    }
  });

export type SignerEnv = z.infer<typeof EnvSchema>;

export interface SignerConfig extends SignerEnv {
  usdtContractHex: string;
  collectorHex: string | null;
  /** Lower-case hex of POOL_TRUSTED_RECIPIENTS. */
  poolTrustedRecipientsHex: string[];
}

/** `KEY=` in .env means "unset", not "empty string". */
function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SignerConfig {
  const parsed = EnvSchema.parse(withoutEmpty(env));
  const usdt = parsed.USDT_CONTRACT ?? USDT_CONTRACT[parsed.NETWORK];
  const poolTrustedRecipientsHex = parsed.POOL_TRUSTED_RECIPIENTS.split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      if (!isBase58Address(a)) throw new Error(`POOL_TRUSTED_RECIPIENTS: ${a} is not a TRON address`);
      return toHexAddress(a).toLowerCase();
    });
  return {
    ...parsed,
    poolTrustedRecipientsHex,
    USDT_CONTRACT: usdt,
    usdtContractHex: toHexAddress(usdt),
    collectorHex: parsed.COLLECTOR_ADDRESS ? toHexAddress(parsed.COLLECTOR_ADDRESS) : null,
  };
}
