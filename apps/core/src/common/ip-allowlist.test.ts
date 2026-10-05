import { describe, expect, it } from 'vitest';
import { IpAllowlist } from './ip-allowlist.js';

describe('IpAllowlist', () => {
  it('is open when empty, matches single IPs, CIDRs and IPv4-mapped IPv6', () => {
    expect(new IpAllowlist([]).allows('8.8.8.8')).toBe(true);
    const l = new IpAllowlist(['10.0.0.0/8', '192.168.1.5', '2001:db8::/32']);
    expect(l.allows('10.20.30.40')).toBe(true);
    expect(l.allows('192.168.1.5')).toBe(true);
    expect(l.allows('192.168.1.6')).toBe(false);
    expect(l.allows('::ffff:10.1.1.1')).toBe(true);
    expect(l.allows('2001:db8:1::1')).toBe(true);
    expect(l.allows('2001:db9::1')).toBe(false);
    expect(l.allows(undefined)).toBe(false);
    expect(l.allows('not-an-ip')).toBe(false);
  });
});
