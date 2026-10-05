import { describe, expect, it } from 'vitest';
import { formatDecimal, shortHash, sumSun, sunToTrx } from './format';

describe('format', () => {
  it('formats decimal strings with thousands separators', () => {
    expect(formatDecimal('1234567.5')).toBe('1,234,567.5');
    expect(formatDecimal('12.5')).toBe('12.5');
    expect(formatDecimal('0')).toBe('0');
    expect(formatDecimal(null)).toBe('—');
  });
  it('converts sun to trx exactly', () => {
    expect(sunToTrx('1000000')).toBe('1');
    expect(sunToTrx('1234567')).toBe('1.234567');
    expect(sunToTrx('500')).toBe('0.0005');
    expect(sunToTrx(null)).toBeNull();
  });
  it('sums sun strings with BigInt', () => {
    expect(sumSun('1', null, '99999999999999999999')).toBe('100000000000000000000');
  });
  it('shortens hashes', () => {
    expect(shortHash('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefgh…uvwxyz');
  });
});
