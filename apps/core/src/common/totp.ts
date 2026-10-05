import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (SHA-1, 30 s step, 6 digits) — what Google Authenticator / Aegis / 1Password expect. */
export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[=\s-]/g, '');
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error('invalid base32');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** 20 random bytes → 32-char base32 secret. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Uint8Array, counter: bigint, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac('sha1', Buffer.from(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpCounter(nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 1000 / TOTP_STEP_S));
}

export function totp(secretBase32: string, nowMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpCounter(nowMs));
}

/**
 * Verify a code against the current step ±`window` steps (clock drift). Returns the matched counter so the caller
 * can refuse a second use of the same code, or null when nothing matches.
 */
export function verifyTotp(secretBase32: string, code: string, opts: { nowMs?: number; window?: number } = {}): bigint | null {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretBase32);
  const now = totpCounter(opts.nowMs ?? Date.now());
  const window = BigInt(opts.window ?? 1);
  for (let c = now - window; c <= now + window; c++) {
    const expected = Buffer.from(hotp(secret, c));
    if (expected.length === clean.length && timingSafeEqual(expected, Buffer.from(clean))) return c;
  }
  return null;
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'USDT Gateway'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_S}`;
}
