import { txContracts, txField, verifyTxConsistency, type TronTxJson } from '@usdt-trx/shared';
import { PolicyError } from './errors.js';

export interface PoolPolicyConfig {
  poolOwnerHex: string;
  maxTransferSun: bigint;
  maxDelegateSun: bigint;
  maxExpirationMs: number;
  /** Recipients (lower-case hex) allowed up to `maxTrustedTransferSun` instead of `maxTransferSun` (energy-provider deposit address). */
  trustedRecipientsHex?: string[];
  maxTrustedTransferSun?: bigint;
}

export interface PoolPolicyResult {
  type: 'DelegateResourceContract' | 'UnDelegateResourceContract' | 'TransferContract' | 'FreezeBalanceV2Contract' | 'UnfreezeBalanceV2Contract';
  receiverHex: string;
  amountSun: bigint;
}

/**
 * The pool key may only: stake/unstake its own TRX (Stake 2.0), delegate/undelegate the resulting resources,
 * and send tiny TRX amounts (account activation). Anything else — voting, permission updates, contracts — is refused.
 */
export function checkPoolTransaction(tx: TronTxJson, cfg: PoolPolicyConfig, nowMs: number = Date.now()): PoolPolicyResult {
  if (!verifyTxConsistency(tx)) throw new PolicyError('TX_INCONSISTENT', 'raw_data, raw_data_hex and txID disagree');
  const contracts = txContracts(tx);
  if (contracts.length !== 1) throw new PolicyError('TX_SHAPE', `expected exactly 1 contract, got ${contracts.length}`);
  const [contract] = contracts;
  if (contract.Permission_id !== undefined && contract.Permission_id !== 0 && contract.Permission_id !== 2) {
    throw new PolicyError('PERMISSION', 'only owner (0) or the first active permission (2) is allowed');
  }
  const value = contract.parameter.value;
  const owner = String(value.owner_address ?? '').toLowerCase();
  if (owner !== cfg.poolOwnerHex) throw new PolicyError('WRONG_OWNER', `owner ${owner} is not the pool wallet`);

  const expiration = Number(txField<number>(tx, 'expiration') ?? 0);
  if (expiration <= nowMs || expiration - nowMs > cfg.maxExpirationMs) {
    throw new PolicyError('EXPIRATION', 'expiration outside the allowed window');
  }

  switch (contract.type) {
    case 'DelegateResourceContract':
    case 'UnDelegateResourceContract': {
      const resource = value.resource === undefined ? 'BANDWIDTH' : String(value.resource);
      if (!['ENERGY', 'BANDWIDTH', '0', '1'].includes(resource)) {
        throw new PolicyError('RESOURCE_TYPE', `unsupported resource ${resource}`);
      }
      const balance = BigInt(String(value.balance ?? 0));
      if (balance <= 0n || balance > cfg.maxDelegateSun) throw new PolicyError('AMOUNT_TOO_LARGE', `delegated balance ${balance} out of range`);
      if (contract.type === 'DelegateResourceContract' && value.lock === true) {
        throw new PolicyError('LOCKED_DELEGATION', 'locked delegation is not allowed');
      }
      return { type: contract.type, receiverHex: String(value.receiver_address ?? '').toLowerCase(), amountSun: balance };
    }
    case 'FreezeBalanceV2Contract':
    case 'UnfreezeBalanceV2Contract': {
      const resource = value.resource === undefined ? 'BANDWIDTH' : String(value.resource);
      if (!['ENERGY', 'BANDWIDTH', '0', '1'].includes(resource)) {
        throw new PolicyError('RESOURCE_TYPE', `unsupported resource ${resource}`);
      }
      const amount = BigInt(String(contract.type === 'FreezeBalanceV2Contract' ? value.frozen_balance ?? 0 : value.unfreeze_balance ?? 0));
      if (amount <= 0n || amount > cfg.maxDelegateSun) throw new PolicyError('AMOUNT_TOO_LARGE', `stake amount ${amount} out of range`);
      return { type: contract.type, receiverHex: owner, amountSun: amount };
    }
    case 'TransferContract': {
      const amount = BigInt(String(value.amount ?? 0));
      const to = String(value.to_address ?? '').toLowerCase();
      const trusted = (cfg.trustedRecipientsHex ?? []).includes(to);
      const limit = trusted ? (cfg.maxTrustedTransferSun ?? cfg.maxTransferSun) : cfg.maxTransferSun;
      if (amount <= 0n || amount > limit) throw new PolicyError('AMOUNT_TOO_LARGE', `TRX amount ${amount} exceeds ${limit}${trusted ? ' (trusted recipient)' : ''}`);
      return { type: contract.type, receiverHex: to, amountSun: amount };
    }
    default:
      throw new PolicyError('CONTRACT_TYPE', `contract type ${contract.type} is not allowed for the pool key`);
  }
}
