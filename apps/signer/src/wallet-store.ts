import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { DEFAULT_PATHS, HdWallet, type WalletPaths } from './hd/wallet.js';
import { decryptSecret, encryptSecret, type EncryptedBlob } from './seed/crypto.js';
import { PolicyError } from './policy/errors.js';

export interface WalletStoreOptions {
  /** Encrypted seed file; created on first create/import, loaded at startup if present. */
  seedFile: string;
  passphrase: string;
  network: string;
  /** Derivation paths of the main and pool wallets (see MAIN_WALLET_PATH / POOL_WALLET_PATH). */
  paths?: WalletPaths;
}

/**
 * Holds the HD wallet in memory. Starts empty when the seed file does not exist yet; the wallet is then
 * created or imported from a BIP39 phrase through the API (the phrase is returned exactly once on create).
 * Seed bytes are derived from the phrase, encrypted to disk, and never leave this process afterwards.
 */
export class WalletStore {
  private wallet: HdWallet | null = null;

  constructor(private readonly opts: WalletStoreOptions) {}

  static fromSeed(seed: Uint8Array, paths: WalletPaths = DEFAULT_PATHS): WalletStore {
    const store = new WalletStore({ seedFile: '', passphrase: '', network: '', paths });
    store.wallet = HdWallet.fromSeed(seed, paths);
    return store;
  }

  /** Load the encrypted seed file if it exists. Returns true when a wallet is now available. */
  loadIfPresent(): boolean {
    if (this.wallet) return true;
    if (!this.opts.seedFile || !existsSync(this.opts.seedFile)) return false;
    const blob = JSON.parse(readFileSync(this.opts.seedFile, 'utf8')) as EncryptedBlob;
    const seed = decryptSecret(blob, this.opts.passphrase);
    this.wallet = HdWallet.fromSeed(seed, this.opts.paths ?? DEFAULT_PATHS);
    seed.fill(0);
    return true;
  }

  initialized(): boolean {
    return this.wallet !== null;
  }

  /** The wallet, or a 409-style policy error when it has not been set up yet. */
  get(): HdWallet {
    if (!this.wallet) throw new PolicyError('WALLET_NOT_INITIALIZED', 'wallet is not set up yet: create or import a seed phrase first');
    return this.wallet;
  }

  create(words: 12 | 24): { mnemonic: string; xpub: string; firstAddress: string } {
    this.assertEmpty();
    const mnemonic = generateMnemonic(wordlist, words === 24 ? 256 : 128);
    const res = this.install(mnemonic, 'created');
    return { mnemonic, ...res };
  }

  import(mnemonic: string): { xpub: string; firstAddress: string } {
    this.assertEmpty();
    const normalized = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
    if (!validateMnemonic(normalized, wordlist)) throw new PolicyError('INVALID_MNEMONIC', 'the seed phrase is not a valid BIP39 phrase (check spelling and word count: 12 or 24)');
    return this.install(normalized, 'imported');
  }

  private assertEmpty(): void {
    if (this.wallet) throw new PolicyError('WALLET_EXISTS', 'a wallet already exists on this signer');
    if (this.opts.seedFile && existsSync(this.opts.seedFile)) throw new PolicyError('WALLET_EXISTS', `seed file ${this.opts.seedFile} already exists`);
  }

  private install(mnemonic: string, label: string): { xpub: string; firstAddress: string } {
    const seed = mnemonicToSeedSync(mnemonic); // 64 bytes, BIP39 (empty passphrase) — TronLink-compatible
    if (this.opts.seedFile) {
      if (this.opts.passphrase.length < 12) throw new PolicyError('WALLET_EXISTS', 'SEED_PASSPHRASE must be at least 12 characters to encrypt the seed file');
      mkdirSync(dirname(this.opts.seedFile), { recursive: true, mode: 0o700 });
      const blob = encryptSecret(seed, this.opts.passphrase, `${label} ${this.opts.network} ${new Date().toISOString()}`);
      writeFileSync(this.opts.seedFile, `${JSON.stringify(blob, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    }
    this.wallet = HdWallet.fromSeed(seed, this.opts.paths ?? DEFAULT_PATHS);
    seed.fill(0);
    const first = this.wallet.derive(0);
    first.wipe();
    return { xpub: this.wallet.xpub(), firstAddress: first.address };
  }
}
