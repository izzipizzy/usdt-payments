import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bytesToHex } from '@noble/hashes/utils';
import {
  USDT_CONTRACT,
  buildDelegateResourceTx,
  buildFreezeBalanceV2Tx,
  buildTrxTransferTx,
  buildUsdtTransferTx,
  makeBlockHeader,
  recoverSigner,
} from '@usdt-trx/shared';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { HdWallet } from './hd/wallet.js';
import { AuditLog } from './audit.js';
import { buildServer, poolKeyFromHex } from './server.js';
import { WalletStore } from './wallet-store.js';

const SEED_HEX = bytesToHex(new Uint8Array(32).map((_, i) => (i * 31 + 7) & 0xff));
const POOL_HEX = bytesToHex(new Uint8Array(32).map((_, i) => (i * 17 + 5) & 0xff));
const TOKEN = 'test-token-test-token-test-token-0123456789';
const wallet = HdWallet.fromSeed(Buffer.from(SEED_HEX, 'hex'));
const collector = wallet.derive(777_777);
const BLOCK_ID = '0000000003a4b7c8f0e1d2c3b4a5968778695a4b3c2d1e0f1122334455667788';

let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'signer-'));
  const config = loadConfig({
    NETWORK: 'nile',
    SIGNER_TOKEN: TOKEN,
    SEED_SOURCE: 'env',
    SEED_HEX,
    COLLECTOR_ADDRESS: collector.address,
    POOL_KEY_SOURCE: 'env',
    POOL_KEY_HEX: POOL_HEX,
    AUDIT_LOG_PATH: join(dir, 'audit.log'),
  });
  app = await buildServer({ config, wallet: WalletStore.fromSeed(Buffer.from(SEED_HEX, 'hex')), pool: poolKeyFromHex(POOL_HEX), audit: new AuditLog(config.AUDIT_LOG_PATH), logger: false });
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}` };
const header = () => makeBlockHeader(61126600, BLOCK_ID, { ttlMs: 600_000 });

describe('signer server', () => {
  it('requires a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/xpub' });
    expect(res.statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/v1/xpub', headers: auth });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().xpub).toBe(wallet.xpub());
  });

  it('derives addresses', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/derive', headers: auth, payload: { index: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().address).toBe(wallet.derive(3).address);
    const batch = await app.inject({ method: 'POST', url: '/v1/derive/batch', headers: auth, payload: { indices: [0, 1, 2] } });
    expect(batch.json().items).toHaveLength(3);
  });

  it('signs a valid sweep and refuses a bad one', async () => {
    const owner = wallet.derive(3);
    const tx = await buildUsdtTransferTx({
      owner: owner.address,
      contract: USDT_CONTRACT.nile,
      to: collector.address,
      amount: 1_000_000n,
      feeLimitSun: 15_000_000n,
      blockHeader: header(),
    });
    const res = await app.inject({ method: 'POST', url: '/v1/sign/sweep', headers: auth, payload: { index: 3, transaction: tx, sweepId: '42' } });
    expect(res.statusCode).toBe(200);
    expect(recoverSigner(tx.txID, res.json().signature)).toBe(owner.addressHex);

    const bad = await buildUsdtTransferTx({
      owner: owner.address,
      contract: USDT_CONTRACT.nile,
      to: wallet.derive(4).address,
      amount: 1_000_000n,
      feeLimitSun: 15_000_000n,
      blockHeader: header(),
    });
    const denied = await app.inject({ method: 'POST', url: '/v1/sign/sweep', headers: auth, payload: { index: 3, transaction: bad } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('WRONG_RECIPIENT');

    const audit = readFileSync(join(dir, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(audit.some((r) => r.kind === 'sign_sweep' && r.ok === true && r.sweepId === '42')).toBe(true);
    expect(audit.some((r) => r.kind === 'sign_sweep' && r.ok === false && r.code === 'WRONG_RECIPIENT')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(SEED_HEX);
  });

  it('signs two-hop payouts: main → hop, hop → recipient, never main → foreign', async () => {
    const main = wallet.payout();
    const hop = wallet.temp(7);
    const recipient = wallet.derive(9).address;
    const stage1 = await buildUsdtTransferTx({ owner: main.address, contract: USDT_CONTRACT.nile, to: hop.address, amount: 5_000_000n, feeLimitSun: 15_000_000n, blockHeader: header() });
    const ok1 = await app.inject({ method: 'POST', url: '/v1/sign/payout', headers: auth, payload: { transaction: stage1, stage: 1, tempIndex: 7 } });
    expect(ok1.statusCode).toBe(200);
    expect(recoverSigner(stage1.txID, ok1.json().signature)).toBe(main.addressHex);

    const direct = await buildUsdtTransferTx({ owner: main.address, contract: USDT_CONTRACT.nile, to: recipient, amount: 5_000_000n, feeLimitSun: 15_000_000n, blockHeader: header() });
    const denied = await app.inject({ method: 'POST', url: '/v1/sign/payout', headers: auth, payload: { transaction: direct, stage: 1, tempIndex: 7 } });
    expect(denied.json().code).toBe('WRONG_RECIPIENT');

    const stage2 = await buildUsdtTransferTx({ owner: hop.address, contract: USDT_CONTRACT.nile, to: recipient, amount: 5_000_000n, feeLimitSun: 15_000_000n, blockHeader: header() });
    const ok2 = await app.inject({ method: 'POST', url: '/v1/sign/payout', headers: auth, payload: { transaction: stage2, stage: 2, tempIndex: 7 } });
    expect(ok2.statusCode).toBe(200);
    expect(recoverSigner(stage2.txID, ok2.json().signature)).toBe(hop.addressHex);

    const wrongHop = await app.inject({ method: 'POST', url: '/v1/sign/payout', headers: auth, payload: { transaction: stage2, stage: 2, tempIndex: 8 } });
    expect(wrongHop.json().code).toBe('WRONG_OWNER');

    const huge = await buildUsdtTransferTx({ owner: hop.address, contract: USDT_CONTRACT.nile, to: recipient, amount: 50_000_000_000n, feeLimitSun: 15_000_000n, blockHeader: header() });
    const denied2 = await app.inject({ method: 'POST', url: '/v1/sign/payout', headers: auth, payload: { transaction: huge, stage: 2, tempIndex: 7 } });
    expect(denied2.json().code).toBe('AMOUNT_TOO_LARGE');

    const derived = await app.inject({ method: 'POST', url: '/v1/derive/temp', headers: auth, payload: { index: 7 } });
    expect(derived.json().address).toBe(hop.address);
    hop.wipe();
  });

  it('signs pool operations within policy', async () => {
    const pool = poolKeyFromHex(POOL_HEX);
    const delegate = await buildDelegateResourceTx({
      owner: pool.address,
      receiver: wallet.derive(3).address,
      amountSun: 5_000_000_000n,
      resource: 'ENERGY',
      blockHeader: header(),
    });
    const ok = await app.inject({ method: 'POST', url: '/v1/sign/pool', headers: auth, payload: { transaction: delegate, purpose: 'delegate' } });
    expect(ok.statusCode).toBe(200);
    expect(recoverSigner(delegate.txID, ok.json().signature)).toBe(pool.addressHex);

    const stake = await buildFreezeBalanceV2Tx({ owner: pool.address, amountSun: 1_000_000_000n, resource: 'ENERGY', blockHeader: header() });
    const staked = await app.inject({ method: 'POST', url: '/v1/sign/pool', headers: auth, payload: { transaction: stake, purpose: 'stake' } });
    expect(staked.statusCode).toBe(200);

    const tooMuch = await buildTrxTransferTx({ from: pool.address, to: wallet.derive(3).address, amountSun: 50_000_000n, blockHeader: header() });
    const denied = await app.inject({ method: 'POST', url: '/v1/sign/pool', headers: auth, payload: { transaction: tooMuch } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('AMOUNT_TOO_LARGE');

    const foreign = await buildTrxTransferTx({ from: wallet.derive(3).address, to: pool.address, amountSun: 1n, blockHeader: header() });
    const denied2 = await app.inject({ method: 'POST', url: '/v1/sign/pool', headers: auth, payload: { transaction: foreign } });
    expect(denied2.json().code).toBe('WRONG_OWNER');
  });
});
