import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { offlineTronWeb } from '@usdt-trx/shared';
import { HdWallet } from './wallet.js';

const SEED = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

describe('HdWallet', () => {
  it('is deterministic and matches TronWeb address from private key', () => {
    const a = HdWallet.fromSeed(SEED);
    const b = HdWallet.fromSeed(SEED);
    const k0 = a.derive(0);
    const k0b = b.derive(0);
    expect(k0.address).toBe(k0b.address);
    expect(k0.path).toBe("m/44'/195'/0'/0/0");
    const fromTronWeb = offlineTronWeb().address.fromPrivateKey(bytesToHex(k0.privateKey));
    expect(fromTronWeb).toBe(k0.address);
    expect(a.derive(1).address).not.toBe(k0.address);
    k0.wipe();
    expect(k0.privateKey.every((x) => x === 0)).toBe(true);
  });

  it('xpub-only derivation matches seed derivation', () => {
    const w = HdWallet.fromSeed(SEED);
    const xpub = w.xpub();
    expect(xpub.startsWith('xpub')).toBe(true);
    for (const i of [0, 1, 42, 1000]) {
      const fromSeed = w.derive(i);
      const fromXpub = HdWallet.addressFromXpub(xpub, i);
      expect(fromXpub.address).toBe(fromSeed.address);
      expect(fromXpub.publicKey).toBe(fromSeed.publicKey);
      fromSeed.wipe();
    }
  });

  it('rejects out of range indices', () => {
    const w = HdWallet.fromSeed(SEED);
    expect(() => w.derive(-1)).toThrow();
    expect(() => w.derive(2 ** 31)).toThrow();
  });
});
