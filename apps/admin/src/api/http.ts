import type { HttpError } from '@refinedev/core';
import { ADMIN_PREFIX, API_BASE, TOKEN_KEY } from '../config';
import i18n from '../i18n';
import type { ApiErrorBody } from './types';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

/**
 * Step-up 2FA. When the server answers 428 `step_up_required`, the registered prompter asks the operator for a
 * 6-digit authenticator code and the request is retried once with `X-TOTP-Code`. The prompter is a React modal
 * registered by <StepUpPrompter/>; codes are single-use, nothing is cached.
 */
export type StepUpPrompter = () => Promise<string | null>;
let stepUpPrompter: StepUpPrompter | null = null;
export const setStepUpPrompter = (fn: StepUpPrompter | null): void => {
  stepUpPrompter = fn;
};

export type QueryValue = string | number | boolean | null | undefined;

export const buildQuery = (query?: Record<string, QueryValue>): string => {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const adminUrl = (path: string, query?: Record<string, QueryValue>): string =>
  `${API_BASE}${ADMIN_PREFIX}${path}${buildQuery(query)}`;

const toHttpError = async (res: Response): Promise<HttpError> => {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body && body.message) {
      message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    }
  } catch {
    /* non-JSON body */
  }
  return { message, statusCode: res.status };
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Explicit token override (used by login before the token is persisted). */
  token?: string | null;
}

/**
 * Fetch wrapper: attaches the bearer token, serialises JSON, converts non-2xx
 * responses to Refine `HttpError` objects so hooks/notifications can use them.
 */
export async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const token = opts.token !== undefined ? opts.token : getToken();
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, body });
  } catch (e) {
    const err: HttpError = { message: e instanceof Error ? e.message : i18n.t('common.networkError'), statusCode: 0 };
    throw err;
  }
  if (res.status === 428 && stepUpPrompter && !opts.headers?.['X-TOTP-Code']) {
    const code = await stepUpPrompter();
    if (!code) throw await toHttpError(res);
    return request<T>(url, { ...opts, headers: { ...(opts.headers ?? {}), 'X-TOTP-Code': code } });
  }
  if (!res.ok) throw await toHttpError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').startsWith('text/csv')) return text as T;
  return (text ? JSON.parse(text) : undefined) as T;
}
