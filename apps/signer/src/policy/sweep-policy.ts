import {
  decodeTransferCalldata,
  txContracts,
  txField,
  verifyTxConsistency,
  type TronTxJson,
} from '@usdt-trx/shared';
import { PolicyError } from './errors.js';

export interface SweepPolicyConfig {
  usdtContractHex: string;
  collectorHex: string;
  maxFeeLimitSun: bigint;
  maxExpirationMs: number;
  maxSweepAmountRaw: bigint; // 0 = unlimited
}

export interface SweepPolicyResult {
  ownerHex: string;
  toHex: string;
  amount: bigint;
  feeLimit: number;
  expiration: number;
}

/**
 * The only thing this signer will sign with a client-derived key:
 * one TriggerSmartContract calling transfer(collector, amount) on the USDT contract,
 * owned by the address derived from the requested index.
 */
export function checkSweepTransaction(
  tx: TronTxJson,
  expectedOwnerHex: string,
  cfg: SweepPolicyConfig,
  nowMs: number = Date.now(),
): SweepPolicyResult {
  if (!verifyTxConsistency(tx)) throw new PolicyError('TX_INCONSISTENT', 'raw_data, raw_data_hex and txID disagree');

  const contracts = txContracts(tx);
  if (contracts.length !== 1) throw new PolicyError('TX_SHAPE', `expected exactly 1 contract, got ${contracts.length}`);
  const [contract] = contracts;
  if (contract.type !== 'TriggerSmartContract') throw new PolicyError('CONTRACT_TYPE', `unexpected contract type ${contract.type}`);
  if (contract.Permission_id !== undefined && contract.Permission_id !== 0) {
    throw new PolicyError('PERMISSION', 'custom Permission_id is not allowed');
  }

  const value = contract.parameter.value;
  const contractAddress = String(value.contract_address ?? '').toLowerCase();
  const owner = String(value.owner_address ?? '').toLowerCase();
  if (contractAddress !== cfg.usdtContractHex) throw new PolicyError('WRONG_CONTRACT', `contract ${contractAddress} is not USDT`);
  if (owner !== expectedOwnerHex.toLowerCase()) throw new PolicyError('WRONG_OWNER', `owner ${owner} != derived ${expectedOwnerHex}`);
  const callValue = Number(value.call_value ?? 0);
  if (callValue !== 0 || value.call_token_value !== undefined || value.token_id !== undefined) {
    throw new PolicyError('CALL_VALUE', 'call_value / token transfer not allowed');
  }

  let decoded;
  try {
    decoded = decodeTransferCalldata(String(value.data ?? ''));
  } catch (e) {
    throw new PolicyError('NOT_TRANSFER', `calldata is not transfer(address,uint256): ${(e as Error).message}`);
  }
  if (decoded.toHex !== cfg.collectorHex) throw new PolicyError('WRONG_RECIPIENT', `recipient ${decoded.to} is not the collector`);
  if (decoded.amount <= 0n) throw new PolicyError('ZERO_AMOUNT', 'amount must be positive');
  if (cfg.maxSweepAmountRaw > 0n && decoded.amount > cfg.maxSweepAmountRaw) {
    throw new PolicyError('AMOUNT_TOO_LARGE', `amount ${decoded.amount} exceeds ceiling ${cfg.maxSweepAmountRaw}`);
  }

  const feeLimit = Number(txField<number>(tx, 'fee_limit') ?? 0);
  if (!Number.isFinite(feeLimit) || feeLimit <= 0 || BigInt(feeLimit) > cfg.maxFeeLimitSun) {
    throw new PolicyError('FEE_LIMIT', `fee_limit ${feeLimit} outside (0, ${cfg.maxFeeLimitSun}]`);
  }

  const expiration = Number(txField<number>(tx, 'expiration') ?? 0);
  const timestamp = Number(txField<number>(tx, 'timestamp') ?? 0);
  if (expiration <= nowMs) throw new PolicyError('EXPIRATION', 'transaction already expired');
  if (expiration - timestamp > cfg.maxExpirationMs || expiration - nowMs > cfg.maxExpirationMs) {
    throw new PolicyError('EXPIRATION', `expiration window exceeds ${cfg.maxExpirationMs} ms`);
  }

  return { ownerHex: owner, toHex: decoded.toHex, amount: decoded.amount, feeLimit, expiration };
}
