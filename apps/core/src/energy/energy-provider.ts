import type { ResourceOperation } from '@prisma/client';
import type { EnergySource } from '@usdt-trx/shared';

export interface ProviderHealth {
  healthy: boolean;
  balanceSun: bigint | null;
  detail: string | null;
}

export interface ProvisionRequest {
  sweepId: bigint;
  address: string; // base58
  energy: number;
  /** Address is not activated yet; the provider must activate it (or fail). */
  activate: boolean;
  idempotencyKey: string;
}

export interface ProvisionResult {
  externalId: string | null;
  costSun: bigint;
  expiresAt: Date | null;
  txId: string | null;
  payload?: Record<string, unknown>;
}

export interface EnergyProvider {
  readonly name: string;
  readonly source: EnergySource;
  enabled(): Promise<boolean>;
  health(): Promise<ProviderHealth>;
  /** Order/delegate energy. Must be idempotent w.r.t. `idempotencyKey` where the backend allows it. */
  provide(req: ProvisionRequest): Promise<ProvisionResult>;
  /** Give the resources back (reclaim rental / undelegate). Best effort. */
  release(op: ResourceOperation): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly permanent = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
