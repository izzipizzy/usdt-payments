export interface PageQuery {
  page?: string | number;
  pageSize?: string | number;
  sort?: string;
}

export interface PageArgs {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
  orderBy: Record<string, 'asc' | 'desc'>;
}

export function parsePage(q: PageQuery, allowedSort: string[], defaultSort = 'createdAt:desc'): PageArgs {
  const asInt = (v: string | number | undefined, dflt: number) => {
    const n = Math.floor(Number(v ?? dflt));
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const page = asInt(q.page, 1);
  const pageSize = Math.min(200, asInt(q.pageSize, 25));
  const [field, dir] = String(q.sort ?? defaultSort).split(':');
  const sortField = allowedSort.includes(field) ? field : defaultSort.split(':')[0];
  const direction: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc';
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize, orderBy: { [sortField]: direction } };
}

export function paginated<T>(items: T[], total: number, args: PageArgs) {
  return { items, total, page: args.page, pageSize: args.pageSize };
}
