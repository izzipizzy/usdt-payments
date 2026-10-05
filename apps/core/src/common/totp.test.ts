import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, hotp, totp, verifyTotp } from './totp.js';

// RFC 6238 appendix B: secret "12345678901234567890" (SHA-1). 8-digit values from the RFC, truncated to 6 here.
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');
const RFC_SECRET_B32 = base32Encode(RFC_SECRET); // GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ

describe('totp', () => {
  it('base32 round-trips and matches the RFC secret encoding', () => {
    expect(RFC_SECRET_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(Buffer.from(base32Decode(RFC_SECRET_B32))).toEqual(Buffer.from(RFC_SECRET));
    expect(base32Decode('gezd gnbv-gy3tqojq')).toEqual(base32Decode('GEZDGNBVGY3TQOJQ'));
  });

  it('matches RFC 6238 test vectors (SHA-1, 6 digits)', () => {
    // T=59 → 94287082, T=1111111109 → 07081804, T=1234567890 → 89005924, T=2000000000 → 69279037
    expect(totp(RFC_SECRET_B32, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET_B32, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET_B32, 1_234_567_890_000)).toBe('005924');
    expect(totp(RFC_SECRET_B32, 2_000_000_000_000)).toBe('279037');
    expect(hotp(RFC_SECRET, 1n, 8)).toBe('94287082');
  });

  it('verifies within ±1 step, rejects outside, returns the matched counter', () => {
    const now = 1_234_567_890_000;
    const code = totp(RFC_SECRET_B32, now);
    expect(verifyTotp(RFC_SECRET_B32, code, { nowMs: now })).toBe(41152263n);
    expect(verifyTotp(RFC_SECRET_B32, code, { nowMs: now + 30_000 })).toBe(41152263n);
    expect(verifyTotp(RFC_SECRET_B32, code, { nowMs: now + 61_000 })).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, '000000', { nowMs: now })).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, 'abc', { nowMs: now })).toBeNull();
  });

  it('generates 32-char base32 secrets', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});
