import { describe, expect, it } from 'vitest';
import { redactSensitive } from './audit.service.js';
import { credentialId } from './auth.js';

describe('audit redaction', () => {
  it('replaces credential-like keys at any depth and keeps everything else', () => {
    const out = redactSensitive({
      itrxApiSecret: 'sk_live_123',
      itrxApiKey: 'key',
      nested: { password: 'p', mnemonic: 'word word', amount: '12.5' },
      list: [{ token: 't' }],
      sweepMinUsdt: '20',
      emptySecret: '',
    });
    expect(out).toEqual({
      itrxApiSecret: '[redacted]',
      itrxApiKey: '[redacted]',
      nested: { password: '[redacted]', mnemonic: '[redacted]', amount: '12.5' },
      list: [{ token: '[redacted]' }],
      sweepMinUsdt: '20',
      emptySecret: '',
    });
  });
});

describe('credentialId', () => {
  it('is stable, short and does not contain the credential', () => {
    const id = credentialId('abcdef-super-secret');
    expect(id).toHaveLength(8);
    expect(id).toBe(credentialId('abcdef-super-secret'));
    expect('abcdef-super-secret').not.toContain(id);
    expect(id).not.toBe(credentialId('abcdef-other'));
  });
});
