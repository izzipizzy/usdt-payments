import { describe, expect, it } from 'vitest';
import { USDT_CONTRACT, buildUsdtTransferTx, makeBlockHeader, toHexAddress, type TronTxJson } from '@usdt-trx/shared';
import { HdWallet } from '../hd/wallet.js';
import { checkPayoutStage1, checkPayoutStage2, type PayoutPolicyConfig } from './payout-policy.js';
import { PolicyError } from './errors.js';

const SEED = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const wallet = HdWallet.fromSeed(SEED);
const main = wallet.payout();
const hop = wallet.temp(42);
const stranger = wallet.derive(7);
const NOW = 1_800_000_000_000;
const BLOCK_ID = '0000000003a4b7c8f0e1d2c3b4a5968778695a4b3c2d1e0f1122334455667788';
const header = makeBlockHeader(61126600, BLOCK_ID, { nowMs: NOW, ttlMs: 600_000 });

const cfg: PayoutPolicyConfig = { usdtContractHex: toHexAddress(USDT_CONTRACT.nile), maxFeeLimitSun: 30_000_000n, maxExpirationMs: 15 * 60_000, maxPayoutRaw: 10_000_000_000n };

function tx(owner: string, to: string, extra: Partial<Parameters<typeof buildUsdtTransferTx>[0]> = {}): Promise<TronTxJson> {
  return buildUsdtTransferTx({ owner, contract: USDT_CONTRACT.nile, to, amount: 5_000_000n, feeLimitSun: 15_000_000n, blockHeader: header, ...extra });
}

function code(fn: () => unknown): string {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof PolicyError ? e.code : `other:${(e as Error).message}`;
  }
}

describe('payout policy', () => {
  it('stage 1 only lets the main wallet pay its own hop address', async () => {
    const ok = await tx(main.address, hop.address);
    const wrongTo = await tx(main.address, stranger.address);
    const wrongOwner = await tx(stranger.address, hop.address);
    expect(code(() => checkPayoutStage1(ok, main.addressHex, hop.addressHex, cfg, NOW))).toBe('OK');
    expect(code(() => checkPayoutStage1(wrongTo, main.addressHex, hop.addressHex, cfg, NOW))).toBe('WRONG_RECIPIENT');
    expect(code(() => checkPayoutStage1(wrongOwner, main.addressHex, hop.addressHex, cfg, NOW))).toBe('WRONG_OWNER');
  });

  it('stage 2 refuses the hop paying itself and enforces the ceiling', async () => {
    const ok = await tx(hop.address, stranger.address);
    const self = await tx(hop.address, hop.address);
    const big = await tx(hop.address, stranger.address, { amount: 10_000_000_001n });
    expect(code(() => checkPayoutStage2(ok, hop.addressHex, cfg, NOW))).toBe('OK');
    expect(code(() => checkPayoutStage2(self, hop.addressHex, cfg, NOW))).toBe('WRONG_RECIPIENT');
    expect(code(() => checkPayoutStage2(big, hop.addressHex, cfg, NOW))).toBe('AMOUNT_TOO_LARGE');
  });

  it('rejects an expiration window longer than allowed even when it has not expired yet', async () => {
    const longHeader = makeBlockHeader(61126600, BLOCK_ID, { nowMs: NOW, ttlMs: 60 * 60_000 });
    const t = await tx(main.address, hop.address, { blockHeader: longHeader });
    expect(code(() => checkPayoutStage1(t, main.addressHex, hop.addressHex, cfg, NOW))).toBe('EXPIRATION');
  });

  it('rejects a TRC-10 token_id smuggled into the call', async () => {
    const t = await tx(main.address, hop.address);
    (t.raw_data as { contract: Array<{ parameter: { value: Record<string, unknown> } }> }).contract[0].parameter.value.token_id = 1000001;
    // raw_data no longer matches raw_data_hex, so consistency fails first; either way the signer refuses.
    expect(['CALL_VALUE', 'TX_INCONSISTENT']).toContain(code(() => checkPayoutStage1(t, main.addressHex, hop.addressHex, cfg, NOW)));
  });
});
