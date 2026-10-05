import type { AuthProvider } from '@refinedev/core';
import { adminUrl, clearToken, getToken, request, setToken } from '../api/http';
import i18n from '../i18n';
import type { Me } from '../api/types';

/** Login = password + 6-digit TOTP code → session token (stored under TOKEN_KEY, sent as `Bearer`). */
export interface LoginParams {
  password: string;
  code: string;
}

interface LoginResult {
  token: string;
  role: Me['role'];
  expiresAt: number;
}

let cachedMe: Me | null = null;
export const getCachedMe = (): Me | null => cachedMe;

const fetchMe = async (token: string | null): Promise<Me> => request<Me>(adminUrl('/me'), { token });

export const authProvider: AuthProvider = {
  login: async ({ password, code }: LoginParams) => {
    // The password is sent exactly as typed (the setup page stores it as typed too); only the code is normalised.
    const trimmedPassword = password ?? '';
    const trimmedCode = (code ?? '').replace(/\s/g, '');
    if (!trimmedPassword.trim()) {
      return { success: false, error: { name: i18n.t('auth.loginFailed'), message: i18n.t('auth.passwordRequired') } };
    }
    if (!/^\d{6}$/.test(trimmedCode)) {
      return { success: false, error: { name: i18n.t('auth.loginFailed'), message: i18n.t('auth.codeRequired') } };
    }
    try {
      const session = await request<LoginResult>(adminUrl('/auth/login'), { method: 'POST', body: { password: trimmedPassword, code: trimmedCode }, token: null });
      cachedMe = await fetchMe(session.token);
      setToken(session.token);
      return { success: true, redirectTo: '/wallet' };
    } catch (e) {
      cachedMe = null;
      const status = (e as { statusCode?: number }).statusCode;
      return {
        success: false,
        error: {
          name: i18n.t('auth.loginFailed'),
          message: status === 401 ? i18n.t('auth.invalidPassword') : (e as Error).message || i18n.t('auth.cannotReachApi'),
        },
      };
    }
  },

  logout: async () => {
    // Revoke server-side first; the local token goes regardless, but say so when the server could not be reached.
    let revoked = true;
    await request(adminUrl('/auth/logout'), { method: 'POST' }).catch(() => {
      revoked = false;
    });
    clearToken();
    cachedMe = null;
    return { success: true, redirectTo: '/login', ...(revoked ? {} : { error: { name: i18n.t('auth.logoutNotRevoked'), message: i18n.t('auth.logoutNotRevokedHint') } }) };
  },

  check: async () => {
    const token = getToken();
    if (!token) return { authenticated: false, redirectTo: '/login', logout: true };
    if (cachedMe) return { authenticated: true };
    try {
      cachedMe = await fetchMe(token);
      return { authenticated: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 401 || status === 403) {
        clearToken();
        return { authenticated: false, redirectTo: '/login', logout: true, error: { name: i18n.t('auth.unauthorized'), message: i18n.t('auth.passwordRejected') } };
      }
      // Network / 5xx: keep session, surface the error.
      return { authenticated: true };
    }
  },

  onError: async (error: { statusCode?: number }) => {
    if (error?.statusCode === 401) {
      clearToken();
      cachedMe = null;
      return { logout: true, redirectTo: '/login', error: { name: i18n.t('auth.unauthorized'), message: i18n.t('auth.sessionExpired') } };
    }
    return {};
  },

  getIdentity: async () => {
    if (cachedMe) return cachedMe;
    const token = getToken();
    if (!token) return null;
    cachedMe = await fetchMe(token);
    return cachedMe;
  },

  getPermissions: async () => {
    const me = cachedMe ?? (await authProvider.getIdentity?.());
    return (me as Me | null)?.role ?? null;
  },
};
