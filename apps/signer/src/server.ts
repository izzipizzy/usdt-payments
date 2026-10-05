import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DeriveRequest,
  SignPoolRequest,
  SignSweepRequest,
  TronTxJson,
  addressFromPublicKey,
  signTx,
  type DeriveResponse,
  type SignResponse,
} from '@usdt-trx/shared';
import { bytesToHex } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import type { SignerConfig } from './config.js';
import type { WalletStore } from './wallet-store.js';
import { AuditLog } from './audit.js';
import { PolicyError } from './policy/errors.js';
import { checkSweepTransaction } from './policy/sweep-policy.js';
import { checkPoolTransaction } from './policy/pool-policy.js';
import { checkPayoutStage1, checkPayoutStage2 } from './policy/payout-policy.js';
import { constantTimeEqual } from './seed/crypto.js';

/** Per-IP fixed-window counter; the signer only ever talks to a handful of core instances. */
class FixedWindowLimiter {
  private windowStart = Date.now();
  private counts = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.counts.clear();
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.max;
  }
}

export interface PoolKey {
  privateKeyHex: string;
  addressHex: string;
  address: string;
}

export interface ServerDeps {
  config: SignerConfig;
  wallet: WalletStore;
  pool: PoolKey | null;
  audit: AuditLog;
  logger?: boolean | object;
}

const DeriveBatchRequest = z.object({ indices: z.array(z.number().int().min(0)).min(1).max(500) });
const WalletCreateRequest = z.object({ words: z.union([z.literal(12), z.literal(24)]).default(12) });
const WalletImportRequest = z.object({ mnemonic: z.string().min(20).max(1000) });
const SignPayoutRequest = z.object({
  transaction: TronTxJson,
  stage: z.union([z.literal(1), z.literal(2)]),
  /** Payout id = derivation index of the one-time hop address. */
  tempIndex: z.number().int().min(0),
  purpose: z.string().optional(),
});
const DeriveTempRequest = z.object({ index: z.number().int().min(0) });

export function poolKeyFromHex(privateKeyHex: string): PoolKey {
  const pub = secp256k1.getPublicKey(privateKeyHex, true);
  const { hex, base58 } = addressFromPublicKey(pub);
  return { privateKeyHex, addressHex: hex, address: base58 };
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, wallet: store, audit } = deps;
  const wallet = { xpub: () => store.get().xpub(), derive: (i: number) => store.get().derive(i) };
  /** External cold collector from config wins; otherwise sweeps go to the main wallet (account 2 of the phrase). */
  const resolveCollector = (): { hex: string; address: string; external: boolean } | null => {
    if (config.collectorHex && config.COLLECTOR_ADDRESS) return { hex: config.collectorHex, address: config.COLLECTOR_ADDRESS, external: true };
    if (!store.initialized()) return null;
    const m = store.get().payout();
    return { hex: m.addressHex, address: m.address, external: false };
  };
  /** Explicit pool key file wins; otherwise the pool is account 1 of the client phrase. */
  const resolvePool = (): PoolKey | null => {
    if (deps.pool) return deps.pool;
    if (!store.initialized()) return null;
    const p = store.get().pool();
    return { privateKeyHex: p.privateKeyHex, addressHex: p.addressHex, address: p.address };
  };
  const app = Fastify({ logger: deps.logger ?? { level: config.LOG_LEVEL }, bodyLimit: 256 * 1024 });
  const limiter = new FixedWindowLimiter(config.RATE_LIMIT_PER_MINUTE, 60_000);

  // Rate limit + bearer auth for everything except /health.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!limiter.allow(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !constantTimeEqual(token, config.SIGNER_TOKEN)) {
      await audit.write({ kind: 'auth_fail', ok: false, ip: req.ip });
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(422).send({ error: 'validation', issues: err.issues });
    }
    if (err instanceof PolicyError) {
      const status = err.code === 'WALLET_NOT_INITIALIZED' || err.code === 'WALLET_EXISTS' ? 409 : err.code === 'INVALID_MNEMONIC' ? 422 : 403;
      return reply.code(status).send({ error: 'policy', code: err.code, message: err.message });
    }
    req.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/health', async () => ({
    ok: true,
    network: config.NETWORK,
    collector: resolveCollector()?.address ?? null,
    usdt: config.USDT_CONTRACT,
    pool: resolvePool()?.address ?? null,
    walletInitialized: store.initialized(),
  }));

  app.get('/v1/wallet', async () => ({
    initialized: store.initialized(),
    network: config.NETWORK,
    xpub: store.initialized() ? store.get().xpub() : null,
    poolAddress: resolvePool()?.address ?? null,
    poolSource: deps.pool ? 'file' : 'derived',
    payoutAddress: store.initialized() ? store.get().payout().address : null,
    mainAddress: store.initialized() ? store.get().payout().address : null,
    collectorAddress: resolveCollector()?.address ?? null,
    collectorExternal: resolveCollector()?.external ?? false,
    mainPath: config.MAIN_WALLET_PATH,
    poolPath: config.POOL_WALLET_PATH,
  }));

  app.post('/v1/wallet/create', async (req) => {
    const { words } = WalletCreateRequest.parse(req.body);
    const res = store.create(words);
    await audit.write({ kind: 'wallet', ok: true, error: `created ${words} words`, ip: req.ip });
    return res; // the mnemonic is returned exactly once and never logged
  });

  app.post('/v1/wallet/import', async (req) => {
    const { mnemonic } = WalletImportRequest.parse(req.body);
    const res = store.import(mnemonic);
    await audit.write({ kind: 'wallet', ok: true, error: 'imported', ip: req.ip });
    return res;
  });

  app.get('/v1/xpub', async () => ({ xpub: wallet.xpub(), path: "m/44'/195'/0'", network: config.NETWORK }));

  app.post('/v1/derive', async (req) => {
    const { index } = DeriveRequest.parse(req.body);
    const key = wallet.derive(index);
    key.wipe();
    await audit.write({ kind: 'derive', ok: true, index, ip: req.ip });
    const res: DeriveResponse = { index, address: key.address, addressHex: key.addressHex, publicKey: key.publicKey };
    return res;
  });

  app.post('/v1/derive/batch', async (req) => {
    const { indices } = DeriveBatchRequest.parse(req.body);
    const items: DeriveResponse[] = indices.map((index) => {
      const key = wallet.derive(index);
      key.wipe();
      return { index, address: key.address, addressHex: key.addressHex, publicKey: key.publicKey };
    });
    await audit.write({ kind: 'derive', ok: true, index: indices[0], ip: req.ip, error: `batch:${indices.length}` });
    return { items };
  });

  app.post('/v1/sign/sweep', async (req) => {
    const body = SignSweepRequest.parse(req.body);
    const tx = TronTxJson.parse(body.transaction);
    const key = wallet.derive(body.index);
    try {
      const collector = resolveCollector();
      if (!collector) throw new PolicyError('WALLET_NOT_INITIALIZED', 'no collector: wallet not set up');
      const check = checkSweepTransaction(tx, key.addressHex, {
        usdtContractHex: config.usdtContractHex,
        collectorHex: collector.hex,
        maxFeeLimitSun: config.MAX_FEE_LIMIT_SUN,
        maxExpirationMs: config.MAX_EXPIRATION_MS,
        maxSweepAmountRaw: config.MAX_SWEEP_AMOUNT_RAW,
      });
      const signature = signTx(bytesToHex(key.privateKey), tx);
      await audit.write({
        kind: 'sign_sweep',
        ok: true,
        index: body.index,
        txID: tx.txID,
        ownerHex: check.ownerHex,
        toHex: check.toHex,
        amount: check.amount.toString(),
        sweepId: body.sweepId,
        ip: req.ip,
      });
      const res: SignResponse = { txID: tx.txID, signature };
      return res;
    } catch (e) {
      const err = e as Error;
      await audit.write({
        kind: 'sign_sweep',
        ok: false,
        index: body.index,
        txID: tx.txID,
        sweepId: body.sweepId,
        code: err instanceof PolicyError ? err.code : undefined,
        error: err.message,
        ip: req.ip,
      });
      throw e;
    } finally {
      key.wipe();
    }
  });

  app.post('/v1/derive/temp', async (req) => {
    const { index } = DeriveTempRequest.parse(req.body);
    const key = store.get().temp(index);
    key.wipe();
    await audit.write({ kind: 'derive', ok: true, index, ip: req.ip, error: 'temp (payout hop)' });
    return { index, address: key.address, addressHex: key.addressHex, publicKey: key.publicKey };
  });

  /**
   * Two-hop payouts: stage 1 main → hop(tempIndex), stage 2 hop(tempIndex) → recipient.
   * The main key therefore never signs a transfer to a foreign address.
   */
  app.post('/v1/sign/payout', async (req) => {
    const body = SignPayoutRequest.parse(req.body);
    const tx = body.transaction;
    const main = store.get().payout();
    const temp = store.get().temp(body.tempIndex);
    const policy = { usdtContractHex: config.usdtContractHex, maxFeeLimitSun: config.MAX_FEE_LIMIT_SUN, maxExpirationMs: config.MAX_EXPIRATION_MS, maxPayoutRaw: config.MAX_PAYOUT_RAW };
    try {
      const check = body.stage === 1 ? checkPayoutStage1(tx, main.addressHex, temp.addressHex, policy) : checkPayoutStage2(tx, temp.addressHex, policy);
      const signature = body.stage === 1 ? signTx(main.privateKeyHex, tx) : signTx(bytesToHex(temp.privateKey), tx);
      await audit.write({ kind: 'sign_payout', ok: true, index: body.tempIndex, txID: tx.txID, ownerHex: body.stage === 1 ? main.addressHex : temp.addressHex, toHex: check.toHex, amount: check.amount.toString(), error: `stage ${body.stage} ${body.purpose ?? ''}`, ip: req.ip });
      const res: SignResponse = { txID: tx.txID, signature };
      return res;
    } catch (e) {
      const err = e as Error;
      await audit.write({ kind: 'sign_payout', ok: false, index: body.tempIndex, txID: tx.txID, code: err instanceof PolicyError ? err.code : undefined, error: err.message, ip: req.ip });
      throw e;
    } finally {
      temp.wipe();
    }
  });

  app.post('/v1/sign/pool', async (req) => {
    const pool = resolvePool();
    if (!pool) throw new PolicyError('POOL_DISABLED', 'pool key is not available: set up the wallet first');
    const body = SignPoolRequest.parse(req.body);
    const tx = TronTxJson.parse(body.transaction);
    try {
      const check = checkPoolTransaction(tx, {
        poolOwnerHex: pool.addressHex,
        maxTransferSun: config.POOL_MAX_TRANSFER_SUN,
        trustedRecipientsHex: config.poolTrustedRecipientsHex,
        maxTrustedTransferSun: config.POOL_MAX_TRUSTED_TRANSFER_SUN,
        maxDelegateSun: config.POOL_MAX_DELEGATE_SUN,
        maxExpirationMs: config.MAX_EXPIRATION_MS,
      });
      const signature = signTx(pool.privateKeyHex, tx);
      await audit.write({
        kind: 'sign_pool',
        ok: true,
        txID: tx.txID,
        ownerHex: pool.addressHex,
        toHex: check.receiverHex,
        amount: check.amountSun.toString(),
        error: body.purpose,
        ip: req.ip,
      });
      const res: SignResponse = { txID: tx.txID, signature };
      return res;
    } catch (e) {
      const err = e as Error;
      await audit.write({
        kind: 'sign_pool',
        ok: false,
        txID: tx.txID,
        code: err instanceof PolicyError ? err.code : undefined,
        error: err.message,
        ip: req.ip,
      });
      throw e;
    }
  });

  return app;
}
