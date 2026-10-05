import { Navigate, useLocation } from 'react-router';
import { useWalletStatus } from '../providers/useWallet';

const WALLET_PATH = '/wallet';

/**
 * Rendered inside the authenticated layout: while the wallet is not
 * initialised every page redirects to the onboarding page. A failed status
 * request (older Core, network error) leaves navigation alone.
 */
export const WalletGuard = ({ children }: { children: React.ReactNode }) => {
  const { wallet } = useWalletStatus();
  const { pathname } = useLocation();
  if (wallet && !wallet.initialized && pathname !== WALLET_PATH) {
    return <Navigate to={WALLET_PATH} replace />;
  }
  return <>{children}</>;
};
