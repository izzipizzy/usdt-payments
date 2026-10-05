/** Base URL of the Core service. Empty string = same origin (dev proxy / nginx). */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
export const ADMIN_PREFIX = '/admin/v1';
export const TOKEN_KEY = 'usdt-trx.admin.token';
export const APP_TITLE = 'USDT Gateway Admin';
export const DASHBOARD_REFRESH_MS = 30_000;
export const WATCHER_LAG_WARN_BLOCKS = 40;
