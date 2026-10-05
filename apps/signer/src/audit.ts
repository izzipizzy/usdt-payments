import { appendFile } from 'node:fs/promises';

export interface AuditRecord {
  ts: string;
  kind: 'derive' | 'sign_sweep' | 'sign_pool' | 'sign_payout' | 'auth_fail' | 'startup' | 'wallet';
  ok: boolean;
  index?: number;
  txID?: string;
  ownerHex?: string;
  toHex?: string;
  amount?: string;
  sweepId?: string;
  code?: string;
  error?: string;
  ip?: string;
}

/** Append-only JSON-lines audit trail. Never contains key material. */
export class AuditLog {
  constructor(private readonly path: string) {}

  async write(record: Omit<AuditRecord, 'ts'>): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
    try {
      await appendFile(this.path, `${line}\n`, { mode: 0o600 });
    } catch (e) {
      // Losing an audit line must not block signing, but it must be loud.
      console.error('audit log write failed', (e as Error).message);
    }
  }
}
