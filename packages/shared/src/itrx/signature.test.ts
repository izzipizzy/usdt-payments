import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { itrxSign, itrxVerify, sortedCompactJson } from './signature.js';

describe('itrx signature', () => {
  it('sorts keys and uses compact separators', () => {
    expect(sortedCompactJson({ period: '1H', energy_amount: 65000, receive_address: 'T1' })).toBe(
      '{"energy_amount":65000,"period":"1H","receive_address":"T1"}',
    );
  });

  it('matches node crypto HMAC over "timestamp&json"', () => {
    const data = { energy_amount: 32000, period: '1D', receive_address: 'TXYZ' };
    const ts = 1700000000;
    const expected = createHmac('sha256', 'secret')
      .update(`${ts}&{"energy_amount":32000,"period":"1D","receive_address":"TXYZ"}`)
      .digest('hex');
    expect(itrxSign('secret', ts, data)).toBe(expected);
    expect(itrxVerify('secret', ts, data, expected)).toBe(true);
    expect(itrxVerify('secret', ts, data, expected.replace(/^./, 'f'))).toBe(false);
  });
});
