import type { BaseRecord, CrudFilter, CrudSort, DataProvider, LogicalFilter } from '@refinedev/core';
import { ADMIN_PREFIX, API_BASE } from '../config';
import { adminUrl, request, type QueryValue } from '../api/http';
import type { Paginated } from '../api/types';
import i18n from '../i18n';

/**
 * Resource name -> REST path under /admin/v1. Every list resource follows the
 * `{ items, total, page, pageSize }` + `sort=field:dir` contract.
 */
const RESOURCE_PATHS: Record<string, string> = {
  addresses: '/addresses',
  deposits: '/deposits',
  sweeps: '/sweeps',
  payouts: '/payouts',
  resources: '/resources',
  audit: '/audit',
  settings: '/settings',
  providers: '/providers',
  queues: '/queues',
};

const pathFor = (resource: string): string => {
  const p = RESOURCE_PATHS[resource];
  if (!p) throw new Error(`Unknown admin resource: ${resource}`);
  return p;
};

const isLogical = (f: CrudFilter): f is LogicalFilter => 'field' in f;

/** Flatten Refine filters into plain query params (field name = param name). */
const filtersToQuery = (filters?: CrudFilter[]): Record<string, QueryValue> => {
  const out: Record<string, QueryValue> = {};
  const walk = (list: CrudFilter[]) => {
    for (const f of list) {
      if (isLogical(f)) {
        const v = f.value as unknown;
        if (v === undefined || v === null || v === '' || v === false) continue;
        if (Array.isArray(v)) {
          if (v.length) out[f.field] = v.join(',');
        } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          out[f.field] = v;
        }
      } else {
        walk(f.value);
      }
    }
  };
  walk(filters ?? []);
  return out;
};

const sortersToQuery = (sorters?: CrudSort[]): string | undefined => {
  const s = sorters?.[0];
  return s ? `${s.field}:${s.order}` : undefined;
};

export const dataProvider: DataProvider = {
  getApiUrl: () => `${API_BASE}${ADMIN_PREFIX}`,

  getList: async <TData extends BaseRecord = BaseRecord>({
    resource,
    pagination,
    sorters,
    filters,
  }: Parameters<DataProvider['getList']>[0]) => {
    const path = pathFor(resource);
    // Non-paginated collections (providers/queues) return plain arrays.
    if (resource === 'providers' || resource === 'queues') {
      const arr = await request<TData[]>(adminUrl(path));
      return { data: arr, total: arr.length };
    }
    const query: Record<string, QueryValue> = {
      ...filtersToQuery(filters),
      sort: sortersToQuery(sorters),
    };
    if (pagination?.mode !== 'off') {
      query.page = pagination?.current ?? 1;
      query.pageSize = pagination?.pageSize ?? 25;
    }
    const res = await request<Paginated<TData>>(adminUrl(path, query));
    return { data: res.items, total: res.total };
  },

  getOne: async <TData extends BaseRecord = BaseRecord>({ resource, id }: Parameters<DataProvider['getOne']>[0]) => {
    const path = pathFor(resource);
    // Singleton resources have no id segment.
    const url = resource === 'settings' ? adminUrl(path) : adminUrl(`${path}/${encodeURIComponent(String(id))}`);
    const data = await request<TData>(url);
    return { data };
  },

  create: async <TData extends BaseRecord = BaseRecord, TVariables = {}>({
    resource,
    variables,
  }: Parameters<DataProvider['create']>[0] & { variables: TVariables }) => {
    const data = await request<TData>(adminUrl(pathFor(resource)), { method: 'POST', body: variables });
    return { data };
  },

  update: async <TData extends BaseRecord = BaseRecord, TVariables = {}>({
    resource,
    id,
    variables,
  }: Parameters<DataProvider['update']>[0] & { variables: TVariables }) => {
    const path = pathFor(resource);
    const url = resource === 'settings' ? adminUrl(path) : adminUrl(`${path}/${encodeURIComponent(String(id))}`);
    const data = await request<TData>(url, { method: 'PATCH', body: variables });
    return { data };
  },

  deleteOne: async () => {
    throw { message: i18n.t('auth.deleteNotSupported'), statusCode: 405 };
  },

  /**
   * Generic escape hatch used for actions (`POST /addresses/:id/sweep`, etc.)
   * and singleton GETs (`/dashboard`, `/me`). `url` may be absolute or relative
   * to `/admin/v1`.
   */
  custom: async <TData extends BaseRecord = BaseRecord, TQuery = unknown, TPayload = unknown>({
    url,
    method,
    payload,
    query,
    headers,
  }: {
    url: string;
    method: 'get' | 'delete' | 'head' | 'options' | 'post' | 'put' | 'patch';
    payload?: TPayload;
    query?: TQuery;
    headers?: {};
  }) => {
    const full = url.startsWith('http') || url.startsWith(API_BASE + ADMIN_PREFIX) ? url : adminUrl(url, query as Record<string, QueryValue> | undefined);
    const m = method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    const data = await request<TData>(full, { method: m, body: payload, headers: headers as Record<string, string> | undefined });
    return { data };
  },
};
