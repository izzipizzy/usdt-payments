/**
 * End-to-end pipeline test against real PostgreSQL + Redis and an in-memory TRON.
 * Run: docker compose up -d postgres redis && pnpm --filter @usdt-trx/core test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { Redis } from 'ioredis';
import { USDT_CONTRACT, parseUsdt, toHexAddress } from '@usdt-trx/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FakeTronNode } from './testing/fake-node.js';
import { totp } from './common/totp.js';
import { FakeSigner } from './testing/fake-signer.js';
import { FakeTronGrid } from './testing/fake-trongrid.js';

const SEED_HEX = bytesToHex(new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff));
const POOL_HEX = bytesToHex(new Uint8Array(32).map((_, i) => (i * 41 + 3) & 0xff));
const COLLECTOR = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'; // any valid address; cold in the design
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://usdt:usdt@localhost:5433/usdt_trx';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

// This suite FLUSHES Redis and TRUNCATES every gateway table. Refuse anything that does not look like a local
// throwaway instance unless the operator explicitly opts in.
for (const [name, url] of [
  ['DATABASE_URL', DATABASE_URL],
  ['REDIS_URL', REDIS_URL],
] as const) {
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if ((!local || process.env.NODE_ENV === 'production') && process.env.ITEST_ALLOW_DESTRUCTIVE !== '1') {
    throw new Error(`refusing to run the destructive integration suite against ${name}=${url}; set ITEST_ALLOW_DESTRUCTIVE=1 if this really is a disposable instance`);
  }
}

const fakeSigner = new FakeSigner(SEED_HEX, POOL_HEX, 'nile', toHexAddress(COLLECTOR), toHexAddress(USDT_CONTRACT.nile));
const fakeNode = new FakeTronNode(USDT_CONTRACT.nile);

Object.assign(process.env, {
  NETWORK: 'nile',
  DATABASE_URL,
  REDIS_URL,
  PORT: '0',
  RUN_WORKERS: 'true',
  ADMIN_TOKENS: 'viewer-token-0001:viewer,operator-token-0001:operator,admin-token-00001:admin',
  ADMIN_PASSWORD: 'itest-admin-password',
  ADMIN_TOTP_SECRET: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  ADMIN_TOTP_STEP_UP: 'false',
  TRON_RPC_URLS: 'http://127.0.0.1:9',
  COLLECTOR_ADDRESS: COLLECTOR,
  SIGNER_URL: 'http://127.0.0.1:9',
  SIGNER_TOKEN: 'x'.repeat(40),
  WALLET_NAME: `itest-${Date.now()}`,
  ADDRESS_POOL_SIZE: '3',
  POOL_ADDRESS: fakeSigner.poolAddress,
  PROVIDER_ORDER: 'own_pool',
  SWEEP_MIN_USDT: '20',
  ENERGY_WAIT_MS: '30000',
  WATCHER_BATCH_BLOCKS: '50',
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v as T;
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

let app: NestFastifyApplication;
let miner: NodeJS.Timeout;
let prisma: import('./prisma/prisma.service.js').PrismaService;
let scanner: import('./watcher/block-scanner.service.js').BlockScannerService;

beforeAll(async () => {
  const [{ Test }, { FastifyAdapter }, { AppModule }, { TronNodeClient }, { SignerClient }, { PrismaService }, { BlockScannerService }, { WorkersService }, { AddressesService }, { TronGridClient }] =
    await Promise.all([
      import('@nestjs/testing'),
      import('@nestjs/platform-fastify'),
      import('./app.module.js'),
      import('./tron/tron-node.client.js'),
      import('./signer/signer.client.js'),
      import('./prisma/prisma.service.js'),
      import('./watcher/block-scanner.service.js'),
      import('./workers/workers.service.js'),
      import('./addresses/addresses.service.js'),
      import('./tron/trongrid.client.js'),
    ]);

  // Clean slate.
  const redis = new Redis(REDIS_URL);
  await redis.flushdb();
  await redis.quit();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TronNodeClient)
    .useValue(fakeNode)
    .overrideProvider(SignerClient)
    .useValue(fakeSigner)
    .overrideProvider(TronGridClient)
    .useValue(new FakeTronGrid(fakeNode))
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: ['error', 'warn'] });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(
    'TRUNCATE sweep_deposits, resource_operations, payouts, deposits, sweeps, chain_events, chain_cursors, deposit_addresses, wallets, audit_log, signer_requests, settings, admin_accounts RESTART IDENTITY CASCADE',
  );
  scanner = app.get(BlockScannerService);
  await app.get(AddressesService).ensureWallet();
  await app.get(WorkersService).start();

  // Pool wallet: activated, TRX for activations, energy to delegate.
  fakeNode.fund(fakeSigner.poolAddress, 1_000_000_000n, { energy: 2_000_000 });
  fakeNode.fund(COLLECTOR, 0n);
  fakeNode.setUsdt(COLLECTOR, 1_000_000n); // 1 USDT keeps the collector "warm"
  fakeNode.mineBlocks(3);
  await scanner.initCursor(); // cursor starts at "now"; deposits are queued after this point
  miner = setInterval(() => fakeNode.mineBlock(), 400);
}, 60_000);

afterAll(async () => {
  clearInterval(miner);
  await app?.close();
});

const operator = { authorization: 'Bearer operator-token-0001' };

describe('deposit gateway end-to-end', () => {
  let address = '';
  let addressId = '';

  it('issues an address idempotently and verifies it against the xpub', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/v1/addresses', headers: operator, payload: { alias: 'client-1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.address).toMatch(/^T/);
    expect(body.derivationIndex).toBe(0);
    address = body.address;
    addressId = body.id;

    const again = await app.inject({ method: 'POST', url: '/admin/v1/addresses', headers: operator, payload: { alias: 'client-1' } });
    expect(again.json().address).toBe(address);
    expect(again.json().created).toBe(false);

    const derived = await fakeSigner.derive(0);
    expect(derived.address).toBe(address);

    const unauth = await app.inject({ method: 'POST', url: '/admin/v1/addresses', payload: { alias: 'x' } });
    expect(unauth.statusCode).toBe(401);
  });

  it('detects a deposit from a solid block exactly once', async () => {
    const txId = fakeNode.externalDeposit(address, parseUsdt('25'));
    await sleep(600); // mined
    const first = await scanner.scanOnce();
    expect(first.events).toBe(1);

    const deposit = await waitFor(() => prisma.deposit.findFirst({ where: { txId } }), 15_000, 'deposit row');
    expect(deposit.amount).toBe(25_000_000n);
    expect(['confirmed', 'credited', 'sweeping', 'swept']).toContain(deposit.status);

    // Re-scan the same blocks: no duplicates.
    await prisma.chainCursor.update({ where: { network_kind: { network: 'nile', kind: 'solid' } }, data: { blockNumber: BigInt(first.cursor - 3) } });
    const second = await scanner.scanOnce();
    expect(second.events).toBe(0);
    expect(await prisma.deposit.count({ where: { txId } })).toBe(1);
  });

  it('activates the address, delegates energy, signs, broadcasts and confirms the sweep', async () => {
    const sweep = await waitFor(
      () => prisma.sweep.findFirst({ where: { depositAddress: { address }, status: 'confirmed' } }),
      90_000,
      'confirmed sweep',
    );
    expect(sweep.amount).toBe(25_000_000n);
    expect(sweep.energySource).toBe('own_pool');
    expect(sweep.txId).toBeTruthy();
    expect(fakeNode.usdtOf(COLLECTOR)).toBe(26_000_000n);
    expect(fakeNode.usdtOf(address)).toBe(0n);
    expect(fakeNode.account(address).activated).toBe(true);

    const deposit = await prisma.deposit.findFirst({ where: { depositAddress: { address } } });
    expect(deposit?.status).toBe('swept');
    expect(deposit?.sweepId).toBe(sweep.id);

    const ops = await prisma.resourceOperation.findMany({ where: { sweepId: sweep.id } });
    expect(ops.some((o) => o.kind === 'delegate_energy' && ['reclaimed', 'delivered'].includes(o.status))).toBe(true);

    const addr = await prisma.depositAddress.findUnique({ where: { address } });
    expect(addr?.onchainStatus).toBe('activated');
    expect(addr?.usdtBalanceCached).toBe(0n);
    expect(addr?.oldestUnsweptAt).toBeNull();
  });

  it('does not sweep below threshold but does on a forced admin request', async () => {
    fakeNode.externalDeposit(address, parseUsdt('5'));
    await sleep(600);
    await scanner.scanOnce();
    await waitFor(() => prisma.deposit.findFirst({ where: { depositAddress: { address }, amount: 5_000_000n } }), 15_000, 'small deposit');
    await sleep(4_000); // let EvaluateSweep run and decide "below threshold"
    expect(await prisma.sweep.count({ where: { depositAddress: { address }, status: { notIn: ['confirmed'] } } })).toBe(0);

    const denied = await app.inject({ method: 'POST', url: `/admin/v1/addresses/${addressId}/sweep`, headers: { authorization: 'Bearer viewer-token-0001' } });
    expect(denied.statusCode).toBe(403);

    const forced = await app.inject({ method: 'POST', url: `/admin/v1/addresses/${addressId}/sweep`, headers: { authorization: 'Bearer operator-token-0001' } });
    expect(forced.statusCode).toBe(200);
    const sweepId = BigInt(forced.json().sweepId);
    const done = await waitFor(() => prisma.sweep.findFirst({ where: { id: sweepId, status: 'confirmed' } }), 90_000, 'forced sweep confirmed');
    expect(done.amount).toBe(5_000_000n);
    expect(fakeNode.usdtOf(COLLECTOR)).toBe(31_000_000n);

    const audit = await prisma.auditLog.findMany({ where: { action: 'address.sweep_now' } });
    expect(audit.length).toBe(1);
  });

  it('pays out USDT from the payout wallet, idempotently by externalId', async () => {
    const recipient = 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy';
    fakeNode.setUsdt(fakeSigner.payoutAddress, parseUsdt('100'));
    fakeNode.fund(fakeSigner.payoutAddress, 0n); // activated, no TRX: energy must come from the pool
    const body = { externalId: 'order-42', to: recipient, amount: '12.5', note: 'refund' };
    const res = await app.inject({ method: 'POST', url: '/admin/v1/payouts', headers: operator, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(true);
    const again = await app.inject({ method: 'POST', url: '/admin/v1/payouts', headers: operator, payload: body });
    expect(again.json().created).toBe(false);
    expect(again.json().id).toBe(res.json().id);

    const tooBig = await app.inject({ method: 'POST', url: '/admin/v1/payouts', headers: operator, payload: { externalId: 'order-43', to: recipient, amount: '5000' } });
    expect(tooBig.statusCode).toBe(422);

    const done = await waitFor(() => prisma.payout.findFirst({ where: { externalId: 'order-42', status: 'confirmed' } }), 150_000, 'payout confirmed');
    expect(done.txId).toBeTruthy();
    expect(done.hop1TxId).toBeTruthy();
    expect(done.stage).toBe(2);
    expect(done.viaAddress).toBeTruthy();
    expect(fakeNode.usdtOf(recipient)).toBe(12_500_000n);
    expect(fakeNode.usdtOf(done.viaAddress!)).toBe(0n);
    expect(fakeNode.usdtOf(fakeSigner.payoutAddress)).toBe(87_500_000n);
    expect(fakeNode.account(done.viaAddress!).activated).toBe(true);
    const viaApi = await app.inject({ method: 'GET', url: `/admin/v1/payouts/${res.json().id}`, headers: operator });
    expect(viaApi.json().status).toBe('confirmed');
  });

  it('rebuilds addresses, deposits, sweeps and stranded hop funds from the chain after a simulated reinstall', async () => {
    const { RecoveryService } = await import('./maintenance/recovery.service.js');
    const { AddressSetService } = await import('./addresses/address-set.service.js');
    const { AddressesService } = await import('./addresses/addresses.service.js');
    const before = {
      deposits: await prisma.deposit.count({ where: { depositAddress: { address } } }),
      sweeps: await prisma.sweep.count({ where: { status: 'confirmed', depositAddress: { address } } }),
    };
    expect(before.deposits).toBeGreaterThanOrEqual(2);
    // A stranded hop: USDT lands on hop #2 (no payout row for it) — a payout that died between its two stages.
    const hop2 = await fakeSigner.deriveTemp(2);
    fakeNode.externalDeposit(hop2.address, 3_000_000n, fakeSigner.payoutAddress);
    fakeNode.mineBlocks(2);
    const mainBefore = fakeNode.usdtOf(fakeSigner.payoutAddress);

    // "Reinstall": everything except the wallet row and the seed is gone.
    await prisma.$executeRawUnsafe('TRUNCATE sweep_deposits, resource_operations, payouts, deposits, sweeps, chain_events, deposit_addresses RESTART IDENTITY CASCADE');
    await prisma.wallet.updateMany({ data: { nextIndex: 0 } });
    app.get(AddressesService).invalidateWallet();
    await app.get(AddressSetService).rebuildFromDb();

    const st = await app.get(RecoveryService).run('itest');
    expect(st.state).toBe('done');
    expect(st.errors).toEqual([]);
    expect(st.addressesRecovered).toBe(1);
    expect(st.depositsIngested).toBe(before.deposits);
    expect(st.sweepsRecovered).toBe(before.sweeps);
    expect(st.hopsRecovered).toBe(1);
    const row = await prisma.depositAddress.findUnique({ where: { address } });
    expect(row?.alias).toBe('recovered-0');
    expect(row?.status).toBe('assigned');
    expect(await prisma.deposit.count({ where: { depositAddressId: row!.id, status: 'swept' } })).toBe(before.deposits);
    expect((await prisma.wallet.findFirst())?.nextIndex).toBe(1);
    const back = await waitFor(() => prisma.payout.findFirst({ where: { externalId: 'recover-hop-2', status: 'confirmed' } }), 120_000, 'hop funds returned');
    expect(back.toAddress).toBe(fakeSigner.payoutAddress);
    expect(fakeNode.usdtOf(hop2.address)).toBe(0n);
    expect(fakeNode.usdtOf(fakeSigner.payoutAddress)).toBe(mainBefore + 3_000_000n);
    // Running it again changes nothing.
    const again = await app.get(RecoveryService).run('itest');
    expect(again.addressesRecovered + again.depositsIngested + again.sweepsRecovered + again.hopsRecovered).toBe(0);
  }, 200_000);

  it('logs an admin in with password + TOTP, refuses a reused code and revokes the session on logout', async () => {
    const code = totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const bad = await app.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { password: 'itest-admin-password', code: '000000' } });
    expect(bad.statusCode).toBe(401);
    const raw = await app.inject({ method: 'GET', url: '/admin/v1/me', headers: { authorization: 'Bearer itest-admin-password' } });
    expect(raw.statusCode).toBe(401); // the password alone is not a bearer credential any more

    const login = await app.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { password: 'itest-admin-password', code } });
    expect(login.statusCode).toBe(200);
    const { token } = login.json();
    const me = await app.inject({ method: 'GET', url: '/admin/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe('admin');
    expect(me.json().authKind).toBe('session');

    const replay = await app.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { password: 'itest-admin-password', code } });
    expect(replay.statusCode).toBe(401);

    const out = await app.inject({ method: 'POST', url: '/admin/v1/auth/logout', headers: { authorization: `Bearer ${token}` } });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/admin/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(after.statusCode).toBe(401);

    const audit = await prisma.auditLog.findMany({ where: { action: { in: ['auth.login', 'auth.login_failed', 'auth.logout'] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['auth.login', 'auth.login_failed', 'auth.login_failed', 'auth.logout']);
  });

  it('reports setup as not needed once a login exists and refuses to start it', async () => {
    const status = await app.inject({ method: 'GET', url: '/admin/v1/setup/status' });
    expect(status.json()).toMatchObject({ needed: false });
    const start = await app.inject({ method: 'POST', url: '/admin/v1/setup/start', payload: { setupToken: 'whatever-token', username: 'root', password: 'long-enough-password' } });
    expect(start.statusCode).toBe(409);
  });

  it('serves the dashboard and settings to admins', async () => {
    const dash = await app.inject({ method: 'GET', url: '/admin/v1/dashboard', headers: { authorization: 'Bearer viewer-token-0001' } });
    expect(dash.statusCode).toBe(200);
    expect(dash.json().collector.usdtBalance).toBe('31');
    expect(dash.json().addresses.assigned).toBe(1);

    const patch = await app.inject({ method: 'PATCH', url: '/admin/v1/settings', headers: { authorization: 'Bearer operator-token-0001' }, payload: { sweepMinUsdt: '10' } });
    expect(patch.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PATCH', url: '/admin/v1/settings', headers: { authorization: 'Bearer admin-token-00001' }, payload: { sweepMinUsdt: '10' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sweepMinUsdt).toBe('10');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json().ok).toBe(true);
  });
});
