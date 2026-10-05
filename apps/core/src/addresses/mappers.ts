import type { Deposit, DepositAddress, Payout, ResourceOperation, Sweep, AuditLog } from '@prisma/client';
import { formatUsdt, type AddressDto, type AuditDto, type DepositDto, type Network, type PayoutDto, type ResourceOpDto, type SweepDto } from '@usdt-trx/shared';
import { explorerAddress, explorerTx } from '../common/explorer.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toAddressDto(network: Network, a: DepositAddress): AddressDto {
  return {
    id: a.id.toString(),
    alias: a.alias,
    address: a.address,
    addressHex: a.addressHex,
    derivationIndex: a.derivationIndex,
    status: a.status,
    onchainStatus: a.onchainStatus,
    usdtBalance: formatUsdt(a.usdtBalanceCached),
    usdtBalanceRaw: a.usdtBalanceCached.toString(),
    balanceCheckedAt: iso(a.balanceCheckedAt),
    lastDepositAt: iso(a.lastDepositAt),
    createdAt: a.createdAt.toISOString(),
    explorerUrl: explorerAddress(network, a.address),
  };
}

export function toDepositDto(network: Network, d: Deposit & { depositAddress?: Pick<DepositAddress, 'alias' | 'address'> }): DepositDto {
  return {
    id: d.id.toString(),
    alias: d.depositAddress?.alias ?? null,
    address: d.depositAddress?.address ?? '',
    txId: d.txId,
    logIndex: d.logIndex,
    blockNumber: Number(d.blockNumber),
    fromAddress: d.fromAddress,
    amount: formatUsdt(d.amount),
    amountRaw: d.amount.toString(),
    status: d.status,
    confirmedAt: iso(d.confirmedAt),
    creditedAt: iso(d.creditedAt),
    sweptAt: iso(d.sweptAt),
    sweepId: d.sweepId ? d.sweepId.toString() : null,
    rejectReason: d.rejectReason,
    explorerUrl: explorerTx(network, d.txId),
  };
}

export function toSweepDto(network: Network, s: Sweep & { depositAddress?: Pick<DepositAddress, 'alias' | 'address'> }): SweepDto {
  return {
    id: s.id.toString(),
    alias: s.depositAddress?.alias ?? null,
    address: s.depositAddress?.address ?? '',
    collectorAddress: s.collectorAddress,
    amount: formatUsdt(s.amount),
    amountRaw: s.amount.toString(),
    status: s.status,
    energySource: s.energySource,
    energyEstimated: s.energyEstimated,
    energyUsed: s.energyUsed,
    bandwidthUsed: s.bandwidthUsed,
    trxFeeBurnedSun: s.trxFeeBurnedSun === null ? null : s.trxFeeBurnedSun.toString(),
    resourceCostSun: s.resourceCostSun === null ? null : s.resourceCostSun.toString(),
    txId: s.txId,
    attempt: s.attempt,
    lastError: s.lastError,
    broadcastAt: iso(s.broadcastAt),
    confirmedAt: iso(s.confirmedAt),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    explorerUrl: s.txId ? explorerTx(network, s.txId) : null,
  };
}

export function toResourceOpDto(op: ResourceOperation): ResourceOpDto {
  return {
    id: op.id.toString(),
    sweepId: op.sweepId ? op.sweepId.toString() : null,
    targetAddress: op.targetAddress,
    kind: op.kind,
    provider: op.provider,
    externalOrderId: op.externalOrderId,
    energyAmount: op.energyAmount,
    bandwidthAmount: op.bandwidthAmount,
    costSun: op.costSun === null ? null : op.costSun.toString(),
    status: op.status,
    txId: op.txId,
    expiresAt: iso(op.expiresAt),
    lastError: op.lastError,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
  };
}

export function toAuditDto(a: AuditLog): AuditDto {
  return {
    id: a.id.toString(),
    actor: a.actor,
    role: a.role,
    action: a.action,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    details: (a.details as Record<string, unknown> | null) ?? null,
    ip: a.ip,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toPayoutDto(network: Network, p: Payout): PayoutDto {
  return {
    id: p.id.toString(),
    externalId: p.externalId,
    fromAddress: p.fromAddress,
    viaAddress: p.viaAddress,
    toAddress: p.toAddress,
    stage: p.stage,
    hop1TxId: p.hop1TxId,
    hop1ExplorerUrl: p.hop1TxId ? explorerTx(network, p.hop1TxId) : null,
    amount: formatUsdt(p.amount),
    amountRaw: p.amount.toString(),
    note: p.note,
    status: p.status,
    energySource: p.energySource,
    energyUsed: p.energyUsed,
    resourceCostSun: p.resourceCostSun === null ? null : p.resourceCostSun.toString(),
    txId: p.txId,
    attempt: p.attempt,
    lastError: p.lastError,
    createdBy: p.createdBy,
    broadcastAt: iso(p.broadcastAt),
    confirmedAt: iso(p.confirmedAt),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    explorerUrl: p.txId ? explorerTx(network, p.txId) : null,
  };
}
