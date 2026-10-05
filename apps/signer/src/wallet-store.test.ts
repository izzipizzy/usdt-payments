import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mnemonicToSeedSync } from '@scure/bip39';
import { WalletStore } from './wallet-store.js';
import { HdWallet } from './hd/wallet.js';

describe('WalletStore', () => {
  it('creates a phrase once, persists it encrypted, and reloads it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    const file = join(dir, 'seed.enc.json');
    const a = new WalletStore({ seedFile: file, passphrase: 'correct horse battery', network: 'nile' });
    expect(a.initialized()).toBe(false);
    expect(() => a.get()).toThrow(/not set up/);
    const created = a.create(12);
    expect(created.mnemonic.split(' ')).toHaveLength(12);
    expect(existsSync(file)).toBe(true);
    expect(() => a.create(12)).toThrow(/already exists/);

    const b = new WalletStore({ seedFile: file, passphrase: 'correct horse battery', network: 'nile' });
    expect(b.loadIfPresent()).toBe(true);
    expect(b.get().xpub()).toBe(created.xpub);
    expect(b.get().derive(0).address).toBe(created.firstAddress);
    expect(b.get().pool().address).toBe(a.get().pool().address);
    expect(b.get().pool().address).not.toBe(created.firstAddress);
    rmSync(dir, { recursive: true, force: true });
  });

  it('imports a phrase (TronLink-compatible derivation) and rejects garbage', () => {
    const store = new WalletStore({ seedFile: '', passphrase: '', network: 'nile' });
    const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const res = store.import(phrase.toUpperCase() + '  ');
    expect(res.firstAddress).toBe(HdWallet.fromSeed(mnemonicToSeedSync(phrase)).derive(0).address);
    const other = new WalletStore({ seedFile: '', passphrase: '', network: 'nile' });
    expect(() => other.import('abandon abandon banana')).toThrow(/not a valid BIP39/);
  });
});
