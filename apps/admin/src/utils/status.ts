import { SweepStatus, DepositStatus, AddressStatus, OnchainStatus, ResourceOpStatus, PayoutStatus } from '@usdt-trx/shared';

/** antd Tag colour per status string. Unknown statuses render default. */
export const sweepStatusColor = (s: string): string => {
  switch (s) {
    case SweepStatus.confirmed:
      return 'green';
    case SweepStatus.failed:
      return 'red';
    case SweepStatus.broadcast:
    case SweepStatus.signing:
    case SweepStatus.ready:
    case SweepStatus.activating:
      return 'blue';
    case SweepStatus.planned:
    case SweepStatus.energy_pending:
      return 'gold';
    case SweepStatus.abandoned:
    case SweepStatus.superseded:
      return 'default';
    default:
      return 'default';
  }
};

export const payoutStatusColor = (s: string): string => {
  switch (s) {
    case PayoutStatus.confirmed:
      return 'green';
    case PayoutStatus.failed:
      return 'red';
    case PayoutStatus.broadcast:
    case PayoutStatus.signing:
    case PayoutStatus.ready:
      return 'blue';
    case PayoutStatus.planned:
    case PayoutStatus.energy_pending:
      return 'gold';
    case PayoutStatus.cancelled:
      return 'default';
    default:
      return 'default';
  }
};

export const depositStatusColor = (s: string): string => {
  switch (s) {
    case DepositStatus.confirmed:
      return 'blue';
    case DepositStatus.credited:
      return 'cyan';
    case DepositStatus.sweeping:
      return 'gold';
    case DepositStatus.swept:
      return 'green';
    case DepositStatus.rejected:
      return 'red';
    default:
      return 'default';
  }
};

export const addressStatusColor = (s: string): string => {
  switch (s) {
    case AddressStatus.assigned:
      return 'green';
    case AddressStatus.available:
      return 'default';
    case AddressStatus.suspended:
      return 'orange';
    case AddressStatus.retired:
      return 'red';
    default:
      return 'default';
  }
};

export const onchainStatusColor = (s: string): string => (s === OnchainStatus.activated ? 'green' : 'default');

export const resourceOpStatusColor = (s: string): string => {
  switch (s) {
    case ResourceOpStatus.delivered:
      return 'green';
    case ResourceOpStatus.failed:
      return 'red';
    case ResourceOpStatus.requested:
      return 'gold';
    case ResourceOpStatus.reclaimed:
    case ResourceOpStatus.expired:
      return 'default';
    default:
      return 'default';
  }
};

export const SWEEP_STATUSES = Object.values(SweepStatus);
export const PAYOUT_STATUSES = Object.values(PayoutStatus);
export const DEPOSIT_STATUSES = Object.values(DepositStatus);
export const ADDRESS_STATUSES = Object.values(AddressStatus);
export const RESOURCE_OP_STATUSES = Object.values(ResourceOpStatus);
