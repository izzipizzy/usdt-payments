import { SELECTOR, TRANSFER_TOPIC } from './constants.js';
import { evmHexToBase58, toEvmHex } from './address.js';

function padWord(hex: string): string {
  if (hex.length > 64) throw new Error('ABI word overflow');
  return hex.padStart(64, '0');
}

export function encodeUint256(value: bigint): string {
  if (value < 0n) throw new Error('uint256 cannot be negative');
  return padWord(value.toString(16));
}

export function encodeAddressWord(address: string): string {
  return padWord(toEvmHex(address));
}

/** Calldata (hex, no 0x) for transfer(address,uint256). */
export function encodeTransfer(to: string, amount: bigint): string {
  return `${SELECTOR.transfer}${encodeAddressWord(to)}${encodeUint256(amount)}`;
}

/** Calldata for balanceOf(address). */
export function encodeBalanceOf(owner: string): string {
  return `${SELECTOR.balanceOf}${encodeAddressWord(owner)}`;
}

export function encodeIsBlackListed(owner: string): string {
  return `${SELECTOR.isBlackListed}${encodeAddressWord(owner)}`;
}

/** Parameters for triggersmartcontract-style calls: everything after the selector. */
export function transferParameter(to: string, amount: bigint): string {
  return `${encodeAddressWord(to)}${encodeUint256(amount)}`;
}

export function decodeUint256(word: string): bigint {
  const clean = word.replace(/^0x/, '');
  if (clean.length === 0) return 0n;
  return BigInt(`0x${clean}`);
}

export interface DecodedTransfer {
  selector: string;
  to: string; // base58
  toHex: string; // 41-prefixed
  amount: bigint;
}

/** Decode transfer(address,uint256) calldata. Throws when it is not a transfer. */
export function decodeTransferCalldata(data: string): DecodedTransfer {
  const clean = data.replace(/^0x/, '').toLowerCase();
  if (clean.length !== 8 + 64 + 64) throw new Error('Not a transfer(address,uint256) calldata');
  const selector = clean.slice(0, 8);
  if (selector !== SELECTOR.transfer) throw new Error(`Unexpected selector ${selector}`);
  const toWord = clean.slice(8, 72);
  if (!/^0{24}[0-9a-f]{40}$/.test(toWord)) throw new Error('Malformed address word');
  const evm = toWord.slice(24);
  return {
    selector,
    to: evmHexToBase58(evm),
    toHex: `41${evm}`,
    amount: decodeUint256(clean.slice(72, 136)),
  };
}

export interface TransferLog {
  fromHex: string;
  toHex: string;
  from: string;
  to: string;
  amount: bigint;
}

/** Decode a TRC-20 Transfer log (topics without 0x, data without 0x). Returns null if not a Transfer. */
export function decodeTransferLog(topics: string[], data: string): TransferLog | null {
  if (topics.length !== 3) return null;
  if (topics[0].replace(/^0x/, '').toLowerCase() !== TRANSFER_TOPIC) return null;
  const fromEvm = topics[1].replace(/^0x/, '').slice(-40).toLowerCase();
  const toEvm = topics[2].replace(/^0x/, '').slice(-40).toLowerCase();
  return {
    fromHex: `41${fromEvm}`,
    toHex: `41${toEvm}`,
    from: evmHexToBase58(fromEvm),
    to: evmHexToBase58(toEvm),
    amount: decodeUint256(data),
  };
}
