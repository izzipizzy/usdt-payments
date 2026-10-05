export type PolicyCode =
  | 'TX_INCONSISTENT'
  | 'TX_SHAPE'
  | 'CONTRACT_TYPE'
  | 'WRONG_CONTRACT'
  | 'WRONG_OWNER'
  | 'WRONG_RECIPIENT'
  | 'NOT_TRANSFER'
  | 'ZERO_AMOUNT'
  | 'AMOUNT_TOO_LARGE'
  | 'FEE_LIMIT'
  | 'EXPIRATION'
  | 'CALL_VALUE'
  | 'PERMISSION'
  | 'POOL_DISABLED'
  | 'RESOURCE_TYPE'
  | 'LOCKED_DELEGATION'
  | 'WALLET_NOT_INITIALIZED'
  | 'WALLET_EXISTS'
  | 'INVALID_MNEMONIC';

export class PolicyError extends Error {
  constructor(
    public readonly code: PolicyCode,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}
