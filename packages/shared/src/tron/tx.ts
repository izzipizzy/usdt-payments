import { TronWeb } from 'tronweb';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { toBase58Address, toHexAddress } from './address.js';
import type { TronTxJson } from '../api/schemas.js';

/** TronWeb instance that never talks to the network; used for offline tx construction. */
let offline: TronWeb | null = null;
export function offlineTronWeb(): TronWeb {
  if (!offline) offline = new TronWeb({ fullHost: 'http://127.0.0.1:9' });
  return offline;
}

export interface BlockHeader {
  ref_block_bytes: string;
  ref_block_hash: string;
  expiration: number;
  timestamp: number;
}

/** TAPOS fields from a reference block. */
export function refBlockParams(blockNumber: number, blockId: string): { ref_block_bytes: string; ref_block_hash: string } {
  const id = blockId.replace(/^0x/, '').toLowerCase();
  if (id.length !== 64) throw new Error('blockId must be 32 bytes hex');
  return {
    ref_block_bytes: (blockNumber & 0xffff).toString(16).padStart(4, '0'),
    ref_block_hash: id.slice(16, 32),
  };
}

export function makeBlockHeader(
  blockNumber: number,
  blockId: string,
  opts: { nowMs?: number; ttlMs: number },
): BlockHeader {
  const now = opts.nowMs ?? Date.now();
  return { ...refBlockParams(blockNumber, blockId), timestamp: now, expiration: now + opts.ttlMs };
}

export function txIdFromRawDataHex(rawDataHex: string): string {
  return bytesToHex(sha256(hexToBytes(rawDataHex.replace(/^0x/, ''))));
}

/** raw_data JSON, raw_data_hex and txID all agree. */
export function verifyTxConsistency(tx: TronTxJson): boolean {
  try {
    if (txIdFromRawDataHex(tx.raw_data_hex) !== tx.txID.toLowerCase()) return false;
    const utils = offlineTronWeb().utils;
    return utils.transaction.txCheck(tx as unknown as Parameters<typeof utils.transaction.txCheck>[0]);
  } catch {
    return false;
  }
}

export interface BuildUsdtTransferArgs {
  owner: string; // base58 or hex
  contract: string; // USDT contract
  to: string;
  amount: bigint;
  feeLimitSun: bigint;
  blockHeader: BlockHeader;
}

/** Offline construction of a USDT transfer(address,uint256) TriggerSmartContract tx. */
export async function buildUsdtTransferTx(args: BuildUsdtTransferArgs): Promise<TronTxJson> {
  const tw = offlineTronWeb();
  const wrapper = await tw.transactionBuilder.triggerSmartContract(
    toHexAddress(args.contract),
    'transfer(address,uint256)',
    {
      feeLimit: Number(args.feeLimitSun),
      callValue: 0,
      txLocal: true,
      blockHeader: args.blockHeader,
    },
    [
      { type: 'address', value: toBase58Address(args.to) },
      { type: 'uint256', value: args.amount.toString() },
    ],
    toHexAddress(args.owner),
  );
  return wrapper.transaction as unknown as TronTxJson;
}

export interface BuildTrxTransferArgs {
  from: string;
  to: string;
  amountSun: bigint;
  blockHeader: BlockHeader;
}

export async function buildTrxTransferTx(args: BuildTrxTransferArgs): Promise<TronTxJson> {
  const tw = offlineTronWeb();
  const tx = await tw.transactionBuilder.sendTrx(toHexAddress(args.to), Number(args.amountSun), toHexAddress(args.from), {
    blockHeader: args.blockHeader,
  });
  return tx as unknown as TronTxJson;
}

export interface BuildDelegateArgs {
  owner: string;
  receiver: string;
  amountSun: bigint; // TRX amount (in sun) whose resource share is delegated
  resource: 'ENERGY' | 'BANDWIDTH';
  blockHeader: BlockHeader;
}

export async function buildDelegateResourceTx(args: BuildDelegateArgs): Promise<TronTxJson> {
  const tw = offlineTronWeb();
  const tx = await tw.transactionBuilder.delegateResource(
    Number(args.amountSun),
    toHexAddress(args.receiver),
    args.resource,
    toHexAddress(args.owner),
    false,
    undefined,
    { blockHeader: args.blockHeader },
  );
  return tx as unknown as TronTxJson;
}

export async function buildUndelegateResourceTx(args: BuildDelegateArgs): Promise<TronTxJson> {
  const tw = offlineTronWeb();
  const tx = await tw.transactionBuilder.undelegateResource(
    Number(args.amountSun),
    toHexAddress(args.receiver),
    args.resource,
    toHexAddress(args.owner),
    { blockHeader: args.blockHeader },
  );
  return tx as unknown as TronTxJson;
}

export interface BuildStakeArgs {
  owner: string;
  amountSun: bigint;
  resource: 'ENERGY' | 'BANDWIDTH';
  blockHeader: BlockHeader;
}

/** Stake 2.0: FreezeBalanceV2 — lock TRX of `owner` for ENERGY or BANDWIDTH. */
export async function buildFreezeBalanceV2Tx(args: BuildStakeArgs): Promise<TronTxJson> {
  const tw = offlineTronWeb();
  const tx = await tw.transactionBuilder.freezeBalanceV2(Number(args.amountSun), args.resource, toHexAddress(args.owner), {
    blockHeader: args.blockHeader,
  });
  return tx as unknown as TronTxJson;
}

/** Stake 2.0: UnfreezeBalanceV2 — TRX becomes withdrawable after the network unstaking period. */
export async function buildUnfreezeBalanceV2Tx(args: BuildStakeArgs): Promise<TronTxJson> {
  const tw = offlineTronWeb();
  const tx = await tw.transactionBuilder.unfreezeBalanceV2(Number(args.amountSun), args.resource, toHexAddress(args.owner), {
    blockHeader: args.blockHeader,
  });
  return tx as unknown as TronTxJson;
}

/** Sign txID with a private key; returns 65-byte hex signature (r||s||v). Does not mutate the input. */
export function signTx(privateKeyHex: string, tx: TronTxJson): string {
  const utils = offlineTronWeb().utils;
  const copy = structuredClone(tx) as unknown as Parameters<typeof utils.crypto.signTransaction>[1];
  const signed = utils.crypto.signTransaction(privateKeyHex.replace(/^0x/, ''), copy);
  const sig = signed.signature[signed.signature.length - 1];
  return sig.replace(/^0x/, '').toLowerCase();
}

/** Recover the signer's hex address (41...) from txID and signature. */
export function recoverSigner(txID: string, signature: string): string {
  return offlineTronWeb().utils.crypto.ecRecover(txID, signature).toLowerCase();
}

export interface TxContract {
  type: string;
  parameter: { value: Record<string, unknown>; type_url?: string };
  Permission_id?: number;
}

export function txContracts(tx: TronTxJson): TxContract[] {
  const contracts = (tx.raw_data as { contract?: unknown }).contract;
  return Array.isArray(contracts) ? (contracts as TxContract[]) : [];
}

export function txField<T = unknown>(tx: TronTxJson, key: string): T | undefined {
  return (tx.raw_data as Record<string, unknown>)[key] as T | undefined;
}
