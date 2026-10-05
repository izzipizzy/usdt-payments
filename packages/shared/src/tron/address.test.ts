import { describe, expect, it } from 'vitest';
import { TronWeb } from 'tronweb';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import {
  addressFromPublicKey,
  base58ToHex,
  evmHexToBase58,
  hexToBase58,
  isBase58Address,
  isHexAddress,
  toEvmHex,
} from './address.js';
import { USDT_CONTRACT } from './constants.js';

const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';

describe('address', () => {
  it('converts USDT contract base58 <-> hex', () => {
    expect(base58ToHex(USDT_CONTRACT.mainnet)).toBe(USDT_HEX);
    expect(hexToBase58(USDT_HEX)).toBe(USDT_CONTRACT.mainnet);
    expect(toEvmHex(USDT_CONTRACT.mainnet)).toBe(USDT_HEX.slice(2));
    expect(evmHexToBase58(USDT_HEX.slice(2))).toBe(USDT_CONTRACT.mainnet);
  });

  it('validates', () => {
    expect(isBase58Address(USDT_CONTRACT.mainnet)).toBe(true);
    expect(isBase58Address(USDT_CONTRACT.mainnet.slice(0, -1) + '1')).toBe(false);
    expect(isBase58Address('0x00')).toBe(false);
    expect(isHexAddress(USDT_HEX)).toBe(true);
    expect(isHexAddress(USDT_HEX.slice(2))).toBe(false);
  });

  it('derives the same address as TronWeb from a public key', () => {
    for (let i = 0; i < 5; i++) {
      const priv = secp256k1.utils.randomPrivateKey();
      const privHex = bytesToHex(priv);
      const expected = TronWeb.address.fromPrivateKey(privHex) as string;
      const compressed = secp256k1.getPublicKey(priv, true);
      const uncompressed = secp256k1.getPublicKey(priv, false);
      expect(addressFromPublicKey(compressed).base58).toBe(expected);
      expect(addressFromPublicKey(uncompressed).base58).toBe(expected);
      expect(addressFromPublicKey(compressed).hex).toBe(TronWeb.address.toHex(expected).toLowerCase());
    }
  });
});
