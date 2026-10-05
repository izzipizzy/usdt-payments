import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config.js';
import { TronNodeClient, TronRpcError } from './tron-node.client.js';

const env = {
  DATABASE_URL: 'postgresql://x',
  SIGNER_TOKEN: 'y'.repeat(32),
  ADMIN_PASSWORD: 'long-enough-password',
  ADMIN_TOTP_SECRET: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  TRON_RPC_URLS: 'http://node.test',
};

function withResponse(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('TronNodeClient.getSolidTransactionInfoByBlock', () => {
  it('returns [] for an empty block and throws on an error envelope so the cursor does not advance', async () => {
    const client = new TronNodeClient(loadConfig(env));
    withResponse([]);
    expect(await client.getSolidTransactionInfoByBlock(1)).toEqual([]);
    withResponse({});
    expect(await client.getSolidTransactionInfoByBlock(1)).toEqual([]);
    withResponse({ Error: 'backend unavailable' });
    await expect(client.getSolidTransactionInfoByBlock(1)).rejects.toBeInstanceOf(TronRpcError);
  });
});

describe('TronNodeClient.broadcast', () => {
  it('treats java-tron DUP_TRANSACTION_ERROR as success (the signed bytes are already in the network)', async () => {
    const client = new TronNodeClient(loadConfig(env));
    withResponse({ result: false, code: 'DUP_TRANSACTION_ERROR', message: Buffer.from('dup').toString('hex') });
    const tx = { txID: 'a'.repeat(64), raw_data: {}, raw_data_hex: 'aa', signature: ['bb'] };
    const res = await client.broadcast(tx);
    expect(res.ok).toBe(true);
    expect(res.txid).toBe(tx.txID);
    withResponse({ result: false, code: 'SIGERROR' });
    expect((await client.broadcast(tx)).ok).toBe(false);
  });
});

describe('loadConfig', () => {
  it('rejects a short admin password and treats empty-string optionals as unset', () => {
    expect(() => loadConfig({ ...env, ADMIN_PASSWORD: 'short' })).toThrow(/12 characters/);
    expect(() => loadConfig({ ...env, ADMIN_TOTP_SECRET: undefined })).toThrow(/ADMIN_TOTP_SECRET is required/);
    expect(loadConfig({ ...env, ADMIN_TOKENS: 'machine-token-0001:viewer' }).adminCredentials.map((c) => [c.role, Boolean(c.totpSecret)])).toEqual([
      ['viewer', false],
      ['admin', true],
    ]);
    expect(loadConfig({ ...env, ADMIN_ALLOWED_IPS: '10.0.0.0/8, 192.168.1.5' }).adminAllowedIps).toEqual(['10.0.0.0/8', '192.168.1.5']);
    expect(() => loadConfig({ ...env, ADMIN_ALLOWED_IPS: 'nope' })).toThrow(/ADMIN_ALLOWED_IPS/);
    expect(() => loadConfig({ ...env, ADMIN_TOTP_SECRET: '================' })).toThrow(/usable base32/);
    expect(() => loadConfig({ ...env, ADMIN_TOTP_SECRET: 'GEZDGNBVGY3TQOJQ' })).not.toThrow();
    expect(loadConfig({ ...env, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...env, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(loadConfig({ ...env }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...env, TRUST_PROXY: 'true' })).toThrow(/spoofable/);
    expect(loadConfig({ ...env, TRONGRID_API_KEY: '', COLLECTOR_ADDRESS: '' }).COLLECTOR_ADDRESS).toBeUndefined();
    expect(() => loadConfig({ ...env, NETWORK: 'mainnet', TRON_RPC_URLS: 'https://nile.trongrid.io' })).toThrow(/testnet/);
  });
});
