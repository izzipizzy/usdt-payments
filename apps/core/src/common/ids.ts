import { BadRequestException } from '@nestjs/common';

/** Route param → bigint id; a non-numeric value is a 400, not a BigInt SyntaxError turned 500. */
export function parseId(raw: string, what = 'id'): bigint {
  if (!/^\d{1,18}$/.test(raw)) throw new BadRequestException(`${what} must be a positive integer`);
  return BigInt(raw);
}

/** Query-string enum filter: unknown values are a 400 instead of a Prisma validation 500. */
export function parseEnum<T extends string>(raw: string | undefined, allowed: readonly T[], what: string): T | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!(allowed as readonly string[]).includes(raw)) throw new BadRequestException(`${what} must be one of ${allowed.join(', ')}`);
  return raw as T;
}
