/** Thrown by pipeline steps when retrying will not help (policy, invalid state). */
export class NonRetryableError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'NON_RETRYABLE',
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/** Thrown when a step should be retried later (network, provider timing). */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'RETRYABLE',
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export function isRetryable(e: unknown): boolean {
  if (e instanceof NonRetryableError) return false;
  if (e instanceof RetryableError) return true;
  const name = (e as Error)?.name;
  if (name === 'SignerPolicyError') return false;
  if (name === 'TronRpcError') return (e as { retryable?: boolean }).retryable !== false;
  return true;
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
