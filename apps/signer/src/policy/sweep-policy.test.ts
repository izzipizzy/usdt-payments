import { describe, expect, it } from 'vitest';
import {
  USDT_CONTRACT,
  buildTrxTransferTx,
  buildUsdtTransferTx,
  makeBlockHeader,
  toHexAddress,
  type TronTxJson,
} from '@usdt-trx/shared';
import { HdWallet } from '../hd/wallet.js';
import { checkSweepTransaction, type SweepPolicyConfig } from './sweep-policy.js';
import { PolicyError } from './errors.js';

const SEED = new Uint8Array(32).map((_, i) => (i * 13 + 1) & 0xff);
const wallet = HdWallet.fromSeed(SEED);
const owner = wallet.derive(5);
const collector = wallet.derive(999_999); // stands in for the collector
const NOW = 1_800_000_000_000;
const BLOCK_ID = '0000000003a4b7c8f0e1d2c3b4a5968778695a4b3c2d1e0f1122334455667788';
const header = makeBlockHeader(61126600, BLOCK_ID, { nowMs: NOW, ttlMs: 600_000 });

const cfg: SweepPolicyConfig = {
  usdtContractHex: toHexAddress(USDT_CONTRACT.nile),
  collectorHex: collector.addressHex,
  maxFeeLimitSun: 30_000_000n,
  maxExpirationMs: 15 * 60_000,
  maxSweepAmountRaw: 0n,
};

async function validTx(overrides: Partial<Parameters<typeof buildUsdtTransferTx>[0]> = {}): Promise<TronTxJson> {
  return buildUsdtTransferTx({
    owner: owner.address,
    contract: USDT_CONTRACT.nile,
    to: collector.address,
    amount: 25_000_000n,
    feeLimitSun: 15_000_000n,
    blockHeader: header,
    ...overrides,
  });
}

function code(fn: () => unknown): string {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof PolicyError ? e.code : `other:${(e as Error).message}`;
  }
}

describe('sweep policy', () => {
  it('accepts a proper sweep', async () => {
    const tx = await validTx();
    const res = checkSweepTransaction(tx, owner.addressHex, cfg, NOW);
    expect(res.amount).toBe(25_000_000n);
    expect(res.toHex).toBe(collector.addressHex);
    expect(res.ownerHex).toBe(owner.addressHex);
  });

  it('rejects wrong recipient', async () => {
    const tx = await validTx({ to: wallet.derive(7).address });
    expect(code(() => checkSweepTransaction(tx, owner.addressHex, cfg, NOW))).toBe('WRONG_RECIPIENT');
  });

  it('rejects wrong owner (index mismatch)', async () => {
    const tx = await validTx();
    expect(code(() => checkSweepTransaction(tx, wallet.derive(6).addressHex, cfg, NOW))).toBe('WRONG_OWNER');
  });

  it('rejects wrong contract', async () => {
    const tx = await validTx({ contract: USDT_CONTRACT.mainnet });
    expect(code(() => checkSweepTransaction(tx, owner.addressHex, cfg, NOW))).toBe('WRONG_CONTRACT');
  });

  it('rejects tampered raw_data (json says collector, hex says attacker)', async () => {
    const good = await validTx();
    const bad = await validTx({ to: wallet.derive(7).address });
    const forged: TronTxJson = { ...good, raw_data_hex: bad.raw_data_hex, txID: bad.txID };
    expect(code(() => checkSweepTransaction(forged, owner.addressHex, cfg, NOW))).toBe('TX_INCONSISTENT');
  });

  it('rejects excessive fee limit and expiration', async () => {
    const big = await validTx({ feeLimitSun: 100_000_000n });
    expect(code(() => checkSweepTransaction(big, owner.addressHex, cfg, NOW))).toBe('FEE_LIMIT');
    const long = await validTx({ blockHeader: makeBlockHeader(61126600, BLOCK_ID, { nowMs: NOW, ttlMs: 3_600_000 }) });
    expect(code(() => checkSweepTransaction(long, owner.addressHex, cfg, NOW))).toBe('EXPIRATION');
    const expired = await validTx();
    expect(code(() => checkSweepTransaction(expired, owner.addressHex, cfg, NOW + 700_000))).toBe('EXPIRATION');
  });

  it('rejects non-transfer calldata and non-trigger contracts', async () => {
    const trx = await buildTrxTransferTx({ from: owner.address, to: collector.address, amountSun: 1n, blockHeader: header });
    expect(code(() => checkSweepTransaction(trx, owner.addressHex, cfg, NOW))).toBe('CONTRACT_TYPE');
  });

  it('enforces amount ceiling when configured', async () => {
    const tx = await validTx({ amount: 5_000_000_000n });
    expect(code(() => checkSweepTransaction(tx, owner.addressHex, { ...cfg, maxSweepAmountRaw: 1_000_000_000n }, NOW))).toBe('AMOUNT_TOO_LARGE');
  });
});
