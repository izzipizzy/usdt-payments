import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { base58check } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';

const b58 = base58check(sha256);
const ADDRESS_PREFIX = 0x41;

/** TRON hex address: 21 bytes, "41" + 20-byte EVM-style address, lower-case hex, no 0x. */
export type TronHexAddress = string;

export function isBase58Address(value: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;
  try {
    const bytes = b58.decode(value);
    return bytes.length === 21 && bytes[0] === ADDRESS_PREFIX;
  } catch {
    return false;
  }
}

export function isHexAddress(value: string): boolean {
  return /^41[0-9a-fA-F]{40}$/.test(value);
}

export function base58ToHex(address: string): TronHexAddress {
  const bytes = b58.decode(address);
  if (bytes.length !== 21 || bytes[0] !== ADDRESS_PREFIX) {
    throw new Error(`Invalid TRON address: ${address}`);
  }
  return bytesToHex(bytes);
}

export function hexToBase58(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!isHexAddress(clean)) throw new Error(`Invalid TRON hex address: ${hex}`);
  return b58.encode(hexToBytes(clean.toLowerCase()));
}

/** Accepts base58 or hex and returns normalised lower-case hex. */
export function toHexAddress(address: string): TronHexAddress {
  if (isHexAddress(address)) return address.toLowerCase();
  return base58ToHex(address);
}

/** Accepts base58 or hex and returns base58. */
export function toBase58Address(address: string): string {
  if (isBase58Address(address)) return address;
  return hexToBase58(address);
}

/** 20-byte EVM-style hex (no prefix), as used inside ABI words and log topics. */
export function toEvmHex(address: string): string {
  return toHexAddress(address).slice(2);
}

export function evmHexToBase58(evmHex: string): string {
  const clean = evmHex.startsWith('0x') ? evmHex.slice(2) : evmHex;
  if (!/^[0-9a-fA-F]{40}$/.test(clean)) throw new Error(`Invalid 20-byte hex: ${evmHex}`);
  return hexToBase58(`41${clean.toLowerCase()}`);
}

/**
 * TRON address from a secp256k1 public key (compressed 33 bytes or uncompressed 65 bytes).
 */
export function addressFromPublicKey(publicKey: Uint8Array | string): { hex: TronHexAddress; base58: string } {
  const raw = typeof publicKey === 'string' ? hexToBytes(publicKey.replace(/^0x/, '')) : publicKey;
  let uncompressed: Uint8Array;
  if (raw.length === 65 && raw[0] === 0x04) {
    uncompressed = raw;
  } else if (raw.length === 33) {
    uncompressed = secp256k1.ProjectivePoint.fromHex(raw).toRawBytes(false);
  } else if (raw.length === 64) {
    uncompressed = new Uint8Array([0x04, ...raw]);
  } else {
    throw new Error(`Unsupported public key length ${raw.length}`);
  }
  const hash = keccak_256(uncompressed.slice(1));
  const body = hash.slice(12);
  const bytes = new Uint8Array(21);
  bytes[0] = ADDRESS_PREFIX;
  bytes.set(body, 1);
  return { hex: bytesToHex(bytes), base58: b58.encode(bytes) };
}

/** Decompress a 33-byte public key into 65 bytes (0x04 || X || Y). */
export function decompressPublicKey(compressed: Uint8Array): Uint8Array {
  return secp256k1.ProjectivePoint.fromHex(compressed).toRawBytes(false);
}
