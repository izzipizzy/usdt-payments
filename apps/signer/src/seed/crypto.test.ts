import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

describe('seed crypto', () => {
  it('round-trips and detects tampering / wrong passphrase', () => {
    const secret = new Uint8Array(32).map((_, i) => i);
    const blob = encryptSecret(secret, 'correct horse battery', 'test', { N: 2 ** 12 });
    expect(decryptSecret(blob, 'correct horse battery')).toEqual(secret);
    expect(() => decryptSecret(blob, 'wrong horse battery!')).toThrow(/decryption failed/);
    const tampered = { ...blob, ct: blob.ct.replace(/^../, blob.ct.startsWith('00') ? '11' : '00') };
    expect(() => decryptSecret(tampered, 'correct horse battery')).toThrow(/decryption failed/);
    expect(() => encryptSecret(secret, 'short')).toThrow(/12 characters/);
  });
});
