import type { AccessControlProvider } from '@refinedev/core';
import type { AdminRole } from '@usdt-trx/shared';
import i18n from '../i18n';
import { getCachedMe } from './authProvider';

const RANK: Record<AdminRole, number> = { viewer: 0, operator: 1, admin: 2 };

export const roleAtLeast = (role: AdminRole | undefined | null, min: AdminRole): boolean =>
  role !== undefined && role !== null && RANK[role] >= RANK[min];

const MUTATING = new Set(['create', 'edit', 'delete', 'clone']);

/** Viewer: read only; operator: actions; admin: settings edit. */
export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const role = getCachedMe()?.role;
    if (!MUTATING.has(action)) return { can: true };
    if (resource === 'settings') return { can: roleAtLeast(role, 'admin'), reason: i18n.t('auth.adminRequired') };
    return { can: roleAtLeast(role, 'operator'), reason: i18n.t('auth.operatorRequired') };
  },
  options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true } },
};
