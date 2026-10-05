import { useGetIdentity } from '@refinedev/core';
import type { AdminRole } from '@usdt-trx/shared';
import type { Me } from '../api/types';
import { roleAtLeast } from './accessControlProvider';

export interface MeInfo {
  me: Me | undefined;
  role: AdminRole | undefined;
  explorerBase: string | undefined;
  isOperator: boolean;
  isAdmin: boolean;
}

export const useMe = (): MeInfo => {
  const { data } = useGetIdentity<Me>();
  const role = data?.role;
  return {
    me: data,
    role,
    explorerBase: data?.explorerBase,
    isOperator: roleAtLeast(role, 'operator'),
    isAdmin: roleAtLeast(role, 'admin'),
  };
};
