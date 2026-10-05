import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the right password, rejects others and tolerates garbage', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', h)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$1$1$zz$zz')).toBe(false);
    expect(await hashPassword('a')).not.toBe(await hashPassword('a'));
  });
});
