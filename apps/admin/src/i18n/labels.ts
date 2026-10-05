import type { TFunction } from 'i18next';

export type StatusKind = 'sweep' | 'payout' | 'deposit' | 'address' | 'onchain' | 'resource';

/** Human label for a status code; unknown codes fall back to the raw value. */
export const statusLabel = (t: TFunction, kind: StatusKind, value: string | null | undefined): string =>
  value ? t(`status.${kind}.${value}`, { defaultValue: value }) : '—';

/** Human label for other enums (`enum.energySource.rental`, `enum.resourceKind.rent_energy`, ...). */
export const enumLabel = (t: TFunction, ns: 'energySource' | 'resourceKind' | 'resourceType' | 'health', value: string | null | undefined): string =>
  value ? t(`enum.${ns}.${value}`, { defaultValue: value }) : '—';

export const roleLabel = (t: TFunction, role: string | null | undefined): string => (role ? t(`role.${role}`, { defaultValue: role }) : '—');

/** `{ value, label }` options for a Select over a status enum. */
export const statusOptions = (t: TFunction, kind: StatusKind, values: readonly string[]) =>
  values.map((v) => ({ value: v, label: statusLabel(t, kind, v) }));
