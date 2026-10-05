import { describe, expect, it } from 'vitest';
import { formatTrx, formatUsdt, parseUsdt } from './units.js';

describe('units', () => {
  it('parses and formats USDT with 6 decimals', () => {
    expect(parseUsdt('20')).toBe(20_000_000n);
    expect(parseUsdt('0.000001')).toBe(1n);
    expect(parseUsdt(1.5)).toBe(1_500_000n);
    expect(() => parseUsdt('1.0000001')).toThrow();
    expect(formatUsdt(20_000_000n)).toBe('20');
    expect(formatUsdt(1_500_000n)).toBe('1.5');
    expect(formatUsdt(0n)).toBe('0');
    expect(formatTrx(6_500_000n)).toBe('6.5');
  });
});
