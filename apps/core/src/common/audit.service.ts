import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthFailureLimiter } from './rate-limit.js';

export interface AuditEntry {
  actor: string;
  role?: string;
  action: string;
  subjectType?: string;
  subjectId?: string | bigint;
  details?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actor: entry.actor,
        role: entry.role,
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId === undefined ? undefined : String(entry.subjectId),
        details: entry.details === undefined ? undefined : (redactSensitive(entry.details) as object),
        ip: entry.ip,
      },
    });
  }
}

/** Keys whose values must never be persisted in audit details. */
const SENSITIVE_KEYS = /secret|password|passphrase|token|mnemonic|api[_-]?key/i;

/** Deep copy with sensitive values replaced; audit rows are readable by every admin viewer. */
export function redactSensitive<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSensitive) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? (v === '' || v === undefined || v === null ? v : '[redacted]') : redactSensitive(v);
    }
    return out as T;
  }
  return value;
}

@Global()
@Module({ providers: [AuditService, AuthFailureLimiter], exports: [AuditService, AuthFailureLimiter] })
export class AuditModule {}
