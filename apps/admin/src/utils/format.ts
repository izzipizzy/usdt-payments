/**
 * Money helpers. All amounts arrive as decimal strings; we never parse them as
 * floats. Thousands separators are inserted into the integer part only.
 */
export const formatDecimal = (value: string | null | undefined, opts: { minFraction?: number } = {}): string => {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value).trim();
  const neg = s.startsWith('-');
  const unsigned = neg ? s.slice(1) : s;
  const [intPartRaw, fracRaw] = unsigned.split('.');
  const intPart = (intPartRaw || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = fracRaw ?? '';
  if (opts.minFraction !== undefined && frac.length < opts.minFraction) frac = frac.padEnd(opts.minFraction, '0');
  return `${neg ? '-' : ''}${intPart}${frac ? `.${frac}` : ''}`;
};

/** Convert an integer SUN string (10^-6 TRX) to a decimal TRX string, exactly. */
export const sunToTrx = (sun: string | null | undefined): string | null => {
  if (sun === null || sun === undefined || sun === '') return null;
  if (!/^-?\d+$/.test(sun)) return null;
  const neg = sun.startsWith('-');
  const digits = (neg ? sun.slice(1) : sun).padStart(7, '0');
  const int = digits.slice(0, -6).replace(/^0+(?=\d)/, '');
  const frac = digits.slice(-6).replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
};

/** Sum two integer strings without floats (BigInt). Nulls count as 0. */
export const sumSun = (...parts: Array<string | null | undefined>): string => {
  let acc = 0n;
  for (const p of parts) {
    if (p && /^-?\d+$/.test(p)) acc += BigInt(p);
  }
  return acc.toString();
};

export const formatInt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(n);

export const shortHash = (h: string | null | undefined, head = 8, tail = 6): string => {
  if (!h) return '—';
  return h.length > head + tail + 3 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;
};
