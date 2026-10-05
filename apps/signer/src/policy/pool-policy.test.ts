import { describe, expect, it } from 'vitest';
import { buildTrxTransferTx, makeBlockHeader, toHexAddress, type TronTxJson } from '@usdt-trx/shared';
import { HdWallet } from '../hd/wallet.js';
import { checkPoolTransaction, type PoolPolicyConfig } from './pool-policy.js';
import { PolicyError } from './errors.js';

const SEED = new Uint8Array(32).map((_, i) => (i * 5 + 9) & 0xff);
const wallet = HdWallet.fromSeed(SEED);
const pool = wallet.pool();
const itrx = wallet.derive(11);
const stranger = wallet.derive(12);
const NOW = 1_800_000_000_000;
const header = makeBlockHeader(61126600, '0000000003a4b7c8f0e1d2c3b4a5968778695a4b3c2d1e0f1122334455667788', { nowMs: NOW, ttlMs: 60_000 });
const cfg: PoolPolicyConfig = { poolOwnerHex: pool.addressHex, maxTransferSun: 2_000_000n, maxDelegateSun: 200_000_000_000n, maxExpirationMs: 15 * 60_000, trustedRecipientsHex: [toHexAddress(itrx.address).toLowerCase()], maxTrustedTransferSun: 100_000_000n };

const tx = (to: string, amountSun: bigint): Promise<TronTxJson> => buildTrxTransferTx({ from: pool.address, to, amountSun, blockHeader: header });
const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof PolicyError ? e.code : `other:${(e as Error).message}`;
  }
};

describe('pool policy: TRX transfers', () => {
  it('caps ordinary recipients at maxTransferSun and trusted ones at maxTrustedTransferSun', async () => {
    const [small, big, trustedOk, trustedTooBig] = await Promise.all([tx(stranger.address, 2_000_000n), tx(stranger.address, 2_000_001n), tx(itrx.address, 50_000_000n), tx(itrx.address, 100_000_001n)]);
    expect(code(() => checkPoolTransaction(small, cfg, NOW))).toBe('OK');
    expect(code(() => checkPoolTransaction(big, cfg, NOW))).toBe('AMOUNT_TOO_LARGE');
    expect(code(() => checkPoolTransaction(trustedOk, cfg, NOW))).toBe('OK');
    expect(code(() => checkPoolTransaction(trustedTooBig, cfg, NOW))).toBe('AMOUNT_TOO_LARGE');
  });
});
