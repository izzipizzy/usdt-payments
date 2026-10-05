export const AddressStatus = {
  available: 'available',
  assigned: 'assigned',
  suspended: 'suspended',
  retired: 'retired',
} as const;
export type AddressStatus = (typeof AddressStatus)[keyof typeof AddressStatus];

export const OnchainStatus = { inactive: 'inactive', activated: 'activated' } as const;
export type OnchainStatus = (typeof OnchainStatus)[keyof typeof OnchainStatus];

export const DepositStatus = {
  confirmed: 'confirmed',
  credited: 'credited',
  sweeping: 'sweeping',
  swept: 'swept',
  rejected: 'rejected',
} as const;
export type DepositStatus = (typeof DepositStatus)[keyof typeof DepositStatus];

export const SweepStatus = {
  planned: 'planned',
  activating: 'activating',
  energy_pending: 'energy_pending',
  ready: 'ready',
  signing: 'signing',
  broadcast: 'broadcast',
  confirmed: 'confirmed',
  failed: 'failed',
  abandoned: 'abandoned',
  superseded: 'superseded',
} as const;
export type SweepStatus = (typeof SweepStatus)[keyof typeof SweepStatus];

/** Statuses in which a sweep still "owns" its address. */
export const ACTIVE_SWEEP_STATUSES: SweepStatus[] = [
  SweepStatus.planned,
  SweepStatus.activating,
  SweepStatus.energy_pending,
  SweepStatus.ready,
  SweepStatus.signing,
  SweepStatus.broadcast,
];

export const EnergySource = { rental: 'rental', own_pool: 'own_pool', burn: 'burn', none: 'none' } as const;
export type EnergySource = (typeof EnergySource)[keyof typeof EnergySource];

export const ResourceOpKind = {
  rent_energy: 'rent_energy',
  delegate_energy: 'delegate_energy',
  undelegate_energy: 'undelegate_energy',
  activate: 'activate',
  send_trx: 'send_trx',
  rent_bandwidth: 'rent_bandwidth',
} as const;
export type ResourceOpKind = (typeof ResourceOpKind)[keyof typeof ResourceOpKind];

export const ResourceOpStatus = {
  requested: 'requested',
  delivered: 'delivered',
  failed: 'failed',
  reclaimed: 'reclaimed',
  expired: 'expired',
} as const;
export type ResourceOpStatus = (typeof ResourceOpStatus)[keyof typeof ResourceOpStatus];


export const PayoutStatus = {
  planned: 'planned',
  energy_pending: 'energy_pending',
  ready: 'ready',
  signing: 'signing',
  broadcast: 'broadcast',
  confirmed: 'confirmed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
export const ACTIVE_PAYOUT_STATUSES: PayoutStatus[] = [PayoutStatus.planned, PayoutStatus.energy_pending, PayoutStatus.ready, PayoutStatus.signing, PayoutStatus.broadcast];
