import { SUN_PER_TRX, USDT_DECIMALS } from './constants.js';

/** "12.5" -> 12500000n (for 6 decimals). Rejects more decimals than allowed. */
export function parseDecimal(value: string | number, decimals: number): bigint {
  const str = typeof value === 'number' ? value.toString() : value.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error(`Invalid decimal: ${value}`);
  const [whole, frac = ''] = str.split('.');
  if (frac.length > decimals) throw new Error(`Too many decimals in ${value}, max ${decimals}`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function formatDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export const parseUsdt = (v: string | number): bigint => parseDecimal(v, USDT_DECIMALS);
export const formatUsdt = (v: bigint): string => formatDecimal(v, USDT_DECIMALS);
export const parseTrx = (v: string | number): bigint => parseDecimal(v, 6);
export const formatTrx = (sun: bigint): string => formatDecimal(sun, 6);
export const trxToSun = (trx: number): bigint => parseTrx(trx);
export const sunToTrxNumber = (sun: bigint): number => Number(sun) / Number(SUN_PER_TRX);
