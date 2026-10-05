/**
 * First-run setup flow against real PostgreSQL + Redis: no login configured → setup page endpoints create the
 * first admin account, enrol TOTP and sign in. Run with the same command as app.itest.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { USDT_CONTRACT, toHexAddress } from '@usdt-trx/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FakeTronNode } from './testing/fake-node.js';
import { FakeSigner } from './testing/fake-signer.js';
import { totp } from './common/totp.js';

const SEED_HEX = bytesToHex(new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff));
const POOL_HEX = bytesToHex(new Uint8Array(32).map((_, i) => (i * 41 + 3) & 0xff));
const COLLECTOR = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://usdt:usdt@localhost:5433/usdt_trx';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
for (const [name, url] of [['DATABASE_URL', DATABASE_URL], ['REDIS_URL', REDIS_URL]] as const) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && process.env.ITEST_ALLOW_DESTRUCTIVE !== '1') throw new Error(`refusing to run against ${name}=${url}`);
}

const fakeSigner = new FakeSigner(SEED_HEX, POOL_HEX, 'nile', toHexAddress(COLLECTOR), toHexAddress(USDT_CONTRACT.nile));
const fakeNode = new FakeTronNode(USDT_CONTRACT.nile);

Object.assign(process.env, {
  NETWORK: 'nile',
  DATABASE_URL,
  REDIS_URL,
  PORT: '0',
  RUN_WORKERS: 'false',
  ADMIN_TOKENS: 'machine-token-000001:viewer', // a machine token is not a login: setup is still needed
  ADMIN_PASSWORD: '',
  ADMIN_TOTP_SECRET: '',
  SETUP_TOKEN: 'itest-setup-token-0001',
  ADMIN_TOTP_STEP_UP: 'true',
  TRON_RPC_URLS: 'http://127.0.0.1:9',
  COLLECTOR_ADDRESS: COLLECTOR,
  SIGNER_URL: 'http://127.0.0.1:9',
  SIGNER_TOKEN: 'x'.repeat(40),
  WALLET_NAME: `itest-setup-${Date.now()}`,
  ADDRESS_POOL_SIZE: '0',
  POOL_ADDRESS: fakeSigner.poolAddress,
  PROVIDER_ORDER: 'own_pool',
});

let app: NestFastifyApplication;
let prisma: import('./prisma/prisma.service.js').PrismaService;

beforeAll(async () => {
  const [{ Test }, { FastifyAdapter }, { AppModule }, { TronNodeClient }, { SignerClient }, { PrismaService }] = await Promise.all([
    import('@nestjs/testing'),
    import('@nestjs/platform-fastify'),
    import('./app.module.js'),
    import('./tron/tron-node.client.js'),
    import('./signer/signer.client.js'),
    import('./prisma/prisma.service.js'),
  ]);
  // Clear accounts BEFORE the app boots so AdminSetupService sees "setup needed" at startup.
  const { PrismaClient } = await import('@prisma/client');
  const pre = new PrismaClient();
  await pre.$executeRawUnsafe('TRUNCATE admin_accounts RESTART IDENTITY CASCADE');
  await pre.$executeRawUnsafe("DELETE FROM settings WHERE key = 'admin.bootstrappedAt'");
  await pre.$disconnect();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TronNodeClient)
    .useValue(fakeNode)
    .overrideProvider(SignerClient)
    .useValue(fakeSigner)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: ['error', 'warn'] });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('first-run setup', () => {
  it('creates the first admin through the setup page and signs in', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/v1/setup/status' })).json()).toMatchObject({ needed: true, network: 'nile' });

    const wrong = await app.inject({ method: 'POST', url: '/admin/v1/setup/start', payload: { setupToken: 'not-the-token', username: 'root', password: 'long-enough-password' } });
    expect(wrong.statusCode).toBe(403);
    const short = await app.inject({ method: 'POST', url: '/admin/v1/setup/start', payload: { setupToken: 'itest-setup-token-0001', username: 'root', password: 'short' } });
    expect(short.statusCode).toBe(422);

    const start = await app.inject({ method: 'POST', url: '/admin/v1/setup/start', payload: { setupToken: 'itest-setup-token-0001', username: 'root', password: 'long-enough-password' } });
    expect(start.statusCode).toBe(200);
    const { attemptId, totpSecret, otpauthUri, qrDataUrl } = start.json();
    // A second browser starts its own attempt; the first one's QR stays valid.
    const other = await app.inject({ method: 'POST', url: '/admin/v1/setup/start', payload: { setupToken: 'itest-setup-token-0001', username: 'other', password: 'long-enough-password' } });
    expect(other.statusCode).toBe(200);
    expect(totpSecret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toContain(`secret=${totpSecret}`);
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const badCode = await app.inject({ method: 'POST', url: '/admin/v1/setup/complete', payload: { setupToken: 'itest-setup-token-0001', attemptId, code: '000000' } });
    expect(badCode.statusCode).toBe(403);
    const done = await app.inject({ method: 'POST', url: '/admin/v1/setup/complete', payload: { setupToken: 'itest-setup-token-0001', attemptId, code: totp(totpSecret) } });
    expect(done.statusCode).toBe(200);
    // The other browser loses: bootstrap already happened.
    const otherDone = await app.inject({ method: 'POST', url: '/admin/v1/setup/complete', payload: { setupToken: 'itest-setup-token-0001', attemptId: other.json().attemptId, code: totp(other.json().totpSecret) } });
    expect(otherDone.statusCode).toBe(409);
    expect(await prisma.adminAccount.count()).toBe(1);
    const session = done.json().token as string;

    const me = await app.inject({ method: 'GET', url: '/admin/v1/me', headers: { authorization: `Bearer ${session}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe('admin');
    expect((await app.inject({ method: 'GET', url: '/admin/v1/setup/status' })).json()).toMatchObject({ needed: false });
    const again = await app.inject({ method: 'POST', url: '/admin/v1/setup/start', payload: { setupToken: 'itest-setup-token-0001', username: 'root2', password: 'long-enough-password' } });
    expect(again.statusCode).toBe(409);

    // The account works through the normal login (fresh code: the setup one is a different time step or burned).
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
    const login = await app.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { password: 'long-enough-password', code: totp(totpSecret) } });
    expect(login.statusCode).toBe(200);
    const row = await prisma.adminAccount.findUnique({ where: { username: 'root' } });
    expect(row?.lastLoginAt).toBeTruthy();
    expect(row?.passwordHash.startsWith('scrypt$')).toBe(true);

    // Step-up: the enrolment code was burned by setup; a fresh login code is burned by login; only a new one works.
    const auth = { authorization: `Bearer ${login.json().token}` };
    const noCode = await app.inject({ method: 'PATCH', url: '/admin/v1/settings', headers: auth, payload: { sweepMinUsdt: '11' } });
    expect(noCode.statusCode).toBe(428);
    const reused = await app.inject({ method: 'PATCH', url: '/admin/v1/settings', headers: { ...auth, 'x-totp-code': totp(totpSecret) }, payload: { sweepMinUsdt: '11' } });
    expect(reused.statusCode).toBe(403);
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
    const withCode = await app.inject({ method: 'PATCH', url: '/admin/v1/settings', headers: { ...auth, 'x-totp-code': totp(totpSecret) }, payload: { sweepMinUsdt: '11' } });
    expect(withCode.statusCode).toBe(200);
    const machine = await app.inject({ method: 'POST', url: '/admin/v1/sweeps/sweep-all', headers: { authorization: 'Bearer machine-token-000001' } });
    expect(machine.statusCode).toBe(403); // viewer role, and machine tokens cannot step up anyway

    // Disabling the account kills its live session immediately, and does NOT reopen setup.
    await prisma.adminAccount.update({ where: { id: row!.id }, data: { disabled: true } });
    expect((await app.inject({ method: 'GET', url: '/admin/v1/me', headers: auth })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/v1/setup/status' })).json()).toMatchObject({ needed: false });
    await prisma.adminAccount.update({ where: { id: row!.id }, data: { disabled: false } });
  }, 150_000);
});
