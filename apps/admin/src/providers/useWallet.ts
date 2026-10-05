import { useCustom } from '@refinedev/core';
import type { WalletStatusDto } from '../api/types';

const WALLET_URL = '/wallet';

/**
 * Wallet onboarding status (`GET /admin/v1/wallet`). The guard and the wallet
 * page share this hook so both read the same query cache entry; `refetch` from
 * either updates both.
 */
export const useWalletStatus = () => {
  const q = useCustom<WalletStatusDto>({
    url: WALLET_URL,
    method: 'get',
    queryOptions: { staleTime: 15_000, refetchOnWindowFocus: false, retry: false },
    successNotification: false,
    errorNotification: false,
  });
  return { wallet: q.data?.data, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
};
