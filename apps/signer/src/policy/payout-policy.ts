import { decodeTransferCalldata, txContracts, txField, verifyTxConsistency, type TronTxJson } from '@usdt-trx/shared';
import { PolicyError } from './errors.js';

export interface PayoutPolicyConfig {
  usdtContractHex: string;
  maxFeeLimitSun: bigint;
  maxExpirationMs: number;
  /** Per-transaction ceiling in raw USDT units; 0 = unlimited. */
  maxPayoutRaw: bigint;
}

export interface PayoutPolicyResult {
  toHex: string;
  amount: bigint;
}

function commonChecks(tx: TronTxJson, ownerHex: string, cfg: PayoutPolicyConfig, nowMs: number) {
  if (!verifyTxConsistency(tx)) throw new PolicyError('TX_INCONSISTENT', 'raw_data, raw_data_hex and txID disagree');
  const contracts = txContracts(tx);
  if (contracts.length !== 1) throw new PolicyError('TX_SHAPE', `expected exactly 1 contract, got ${contracts.length}`);
  const [contract] = contracts;
  if (contract.type !== 'TriggerSmartContract') throw new PolicyError('CONTRACT_TYPE', `unexpected contract type ${contract.type}`);
  if (contract.Permission_id !== undefined && contract.Permission_id !== 0) throw new PolicyError('PERMISSION', 'custom Permission_id is not allowed');
  const value = contract.parameter.value;
  if (String(value.contract_address ?? '').toLowerCase() !== cfg.usdtContractHex) throw new PolicyError('WRONG_CONTRACT', 'contract is not USDT');
  if (String(value.owner_address ?? '').toLowerCase() !== ownerHex) throw new PolicyError('WRONG_OWNER', 'owner does not match the expected wallet');
  if (Number(value.call_value ?? 0) !== 0 || value.call_token_value !== undefined || value.token_id !== undefined) {
    throw new PolicyError('CALL_VALUE', 'call_value / token transfer not allowed');
  }
  let decoded;
  try {
    decoded = decodeTransferCalldata(String(value.data ?? ''));
  } catch (e) {
    throw new PolicyError('NOT_TRANSFER', `calldata is not transfer(address,uint256): ${(e as Error).message}`);
  }
  if (decoded.amount <= 0n) throw new PolicyError('ZERO_AMOUNT', 'amount must be positive');
  if (cfg.maxPayoutRaw > 0n && decoded.amount > cfg.maxPayoutRaw) throw new PolicyError('AMOUNT_TOO_LARGE', `payout ${decoded.amount} exceeds the per-transaction ceiling ${cfg.maxPayoutRaw}`);
  const feeLimit = Number(txField<number>(tx, 'fee_limit') ?? 0);
  if (!Number.isFinite(feeLimit) || feeLimit <= 0 || BigInt(feeLimit) > cfg.maxFeeLimitSun) throw new PolicyError('FEE_LIMIT', `fee_limit ${feeLimit} out of range`);
  const expiration = Number(txField<number>(tx, 'expiration') ?? 0);
  const timestamp = Number(txField<number>(tx, 'timestamp') ?? 0);
  if (expiration <= nowMs) throw new PolicyError('EXPIRATION', 'transaction already expired');
  if (expiration - timestamp > cfg.maxExpirationMs || expiration - nowMs > cfg.maxExpirationMs) {
    throw new PolicyError('EXPIRATION', `expiration window exceeds ${cfg.maxExpirationMs} ms`);
  }
  return decoded;
}

/** Stage 1: the main wallet may only send to one of its own one-time hop addresses. */
export function checkPayoutStage1(tx: TronTxJson, mainHex: string, tempHex: string, cfg: PayoutPolicyConfig, nowMs: number = Date.now()): PayoutPolicyResult {
  const d = commonChecks(tx, mainHex, cfg, nowMs);
  if (d.toHex !== tempHex) throw new PolicyError('WRONG_RECIPIENT', `stage 1 must go to the hop address ${tempHex}, not ${d.toHex}`);
  return { toHex: d.toHex, amount: d.amount };
}

/** Stage 2: the hop address forwards to the recipient (any address except itself). */
export function checkPayoutStage2(tx: TronTxJson, tempHex: string, cfg: PayoutPolicyConfig, nowMs: number = Date.now()): PayoutPolicyResult {
  const d = commonChecks(tx, tempHex, cfg, nowMs);
  if (d.toHex === tempHex) throw new PolicyError('WRONG_RECIPIENT', 'hop address cannot pay itself');
  return { toHex: d.toHex, amount: d.amount };
}
