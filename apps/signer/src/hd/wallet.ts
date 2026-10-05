import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils';
import { DERIVATION_ACCOUNT_PATH, addressFromPublicKey } from '@usdt-trx/shared';

export interface DerivedKey {
  index: number;
  path: string;
  address: string;
  addressHex: string;
  publicKey: string; // compressed hex
  /** Caller must call `wipe()` as soon as the key was used. */
  privateKey: Uint8Array;
  wipe(): void;
}

/**
 * Holds the BIP32 account node (m/44'/195'/0') in memory. The master seed is discarded
 * right after the account node is derived so it never lingers on the heap longer than needed.
 */
export interface PoolKeyInfo {
  privateKeyHex: string;
  address: string;
  addressHex: string;
  path: string;
}

/** Service wallet that pays for activations/energy: account 1 of the same phrase (m/44'/195'/1'/0/0). */
export const POOL_PATH = "m/44'/195'/1'/0/0";
/** Main wallet (balance, sweeps, payouts): account 2 of the same phrase (m/44'/195'/2'/0/0) by default. */
export const PAYOUT_PATH = "m/44'/195'/2'/0/0";
/** TronLink / most wallet apps show this path as "the" address of a phrase. */
export const TRONLINK_FIRST_PATH = "m/44'/195'/0'/0/0";

export interface WalletPaths {
  /** Main wallet path. Set to TRONLINK_FIRST_PATH to make an existing wallet-app address the main wallet. */
  main: string;
  pool: string;
}
export const DEFAULT_PATHS: WalletPaths = { main: PAYOUT_PATH, pool: POOL_PATH };
/** One-time hop addresses for payouts: account 3, index = payout id (m/44'/195'/3'/0/{i}). */
export const PAYOUT_TEMP_ACCOUNT_PATH = "m/44'/195'/3'";

function keyAt(master: HDKey, path: string): PoolKeyInfo {
  const node = master.derive(path);
  if (!node.privateKey || !node.publicKey) throw new Error(`derivation failed at ${path}`);
  const { hex, base58 } = addressFromPublicKey(node.publicKey);
  const info: PoolKeyInfo = { privateKeyHex: bytesToHex(node.privateKey), address: base58, addressHex: hex, path };
  node.wipePrivateData();
  return info;
}

export class HdWallet {
  private constructor(
    private readonly account: HDKey,
    private readonly poolKey: PoolKeyInfo,
    private readonly payoutKey: PoolKeyInfo,
    private readonly tempAccount: HDKey,
  ) {}

  static fromSeed(seed: Uint8Array, paths: WalletPaths = DEFAULT_PATHS): HdWallet {
    if (seed.length < 16 || seed.length > 64) throw new Error('seed must be 16..64 bytes');
    if (!/^m(\/\d+'?)+$/.test(paths.main) || !/^m(\/\d+'?)+$/.test(paths.pool)) throw new Error('wallet paths must look like m/44\'/195\'/2\'/0/0');
    if (paths.main === paths.pool) throw new Error('main and pool wallet paths must differ');
    const master = HDKey.fromMasterSeed(seed);
    const account = master.derive(DERIVATION_ACCOUNT_PATH);
    const poolKey = keyAt(master, paths.pool);
    const payoutKey = keyAt(master, paths.main);
    const tempAccount = master.derive(PAYOUT_TEMP_ACCOUNT_PATH);
    master.wipePrivateData();
    return new HdWallet(account, poolKey, payoutKey, tempAccount);
  }

  /** One-time payout hop key for a payout id. Caller wipes the private key after use. */
  temp(index: number): DerivedKey {
    if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new Error('index out of range');
    const child = this.tempAccount.deriveChild(0).deriveChild(index);
    if (!child.privateKey || !child.publicKey) throw new Error('derivation produced no key');
    const { hex, base58 } = addressFromPublicKey(child.publicKey);
    const privateKey = new Uint8Array(child.privateKey);
    child.wipePrivateData();
    return { index, path: `${PAYOUT_TEMP_ACCOUNT_PATH}/0/${index}`, address: base58, addressHex: hex, publicKey: bytesToHex(child.publicKey), privateKey, wipe: () => privateKey.fill(0) };
  }

  /** The pool (fee-paying) key derived from the same phrase. */
  pool(): PoolKeyInfo {
    return this.poolKey;
  }

  /** The payout (hot, outgoing USDT) key derived from the same phrase. */
  payout(): PoolKeyInfo {
    return this.payoutKey;
  }

  /** Account-level xpub; safe to hand to core for independent address verification. */
  xpub(): string {
    return this.account.publicExtendedKey;
  }

  derive(index: number): DerivedKey {
    if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new Error('index out of range');
    const child = this.account.deriveChild(0).deriveChild(index);
    if (!child.privateKey || !child.publicKey) throw new Error('derivation produced no key');
    const { hex, base58 } = addressFromPublicKey(child.publicKey);
    const privateKey = new Uint8Array(child.privateKey);
    child.wipePrivateData();
    return {
      index,
      path: `${DERIVATION_ACCOUNT_PATH}/0/${index}`,
      address: base58,
      addressHex: hex,
      publicKey: bytesToHex(child.publicKey),
      privateKey,
      wipe: () => privateKey.fill(0),
    };
  }

  /** Public-only derivation from an xpub, as core does it. */
  static addressFromXpub(xpub: string, index: number): { address: string; addressHex: string; publicKey: string } {
    const account = HDKey.fromExtendedKey(xpub);
    const child = account.deriveChild(0).deriveChild(index);
    if (!child.publicKey) throw new Error('no public key');
    const { hex, base58 } = addressFromPublicKey(child.publicKey);
    return { address: base58, addressHex: hex, publicKey: bytesToHex(child.publicKey) };
  }
}
