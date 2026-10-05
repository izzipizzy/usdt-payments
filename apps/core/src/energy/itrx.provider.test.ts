import { describe, expect, it } from 'vitest';
import { isInsufficientFunds, topUpAmount } from './itrx.provider.js';

const cfg = { ITRX_TOPUP_RESERVE_SUN: 2_000_000n, ITRX_TOPUP_MIN_SUN: 10_000_000n, ITRX_TOPUP_MAX_SUN: 100_000_000n };

describe('itrx auto top-up', () => {
  it('sends the exact shortfall plus reserve, clamped to the configured range', () => {
    expect(topUpAmount(30_000_000n, 3_000_000n, cfg)).toBe(29_000_000n); // 30 - 3 + 2
    expect(topUpAmount(30_000_000n, null, cfg)).toBe(32_000_000n); // unknown balance → assume 0
    expect(topUpAmount(1_000_000n, 900_000n, cfg)).toBe(10_000_000n); // never below the itrx minimum deposit
    expect(topUpAmount(500_000_000n, 0n, cfg)).toBe(100_000_000n); // never above the maximum
  });
  it('recognises the itrx "Insufficient funds" answer', () => {
    expect(isInsufficientFunds(new Error('itrx POST order HTTP 400: {"detail":"Insufficient funds"}'))).toBe(true);
    expect(isInsufficientFunds(new Error('HTTP 500'))).toBe(false);
  });
});
