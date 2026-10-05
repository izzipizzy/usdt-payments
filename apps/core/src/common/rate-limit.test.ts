import { describe, expect, it } from 'vitest';
import { FixedWindowAttemptLimiter } from './rate-limit.js';

describe('FixedWindowAttemptLimiter', () => {
  it('reserves before verification, refunds on success, and ignores stale refunds', () => {
    const l = new FixedWindowAttemptLimiter(2, 1_000_000);
    const a = l.acquire('ip');
    const b = l.acquire('ip');
    expect(a && b).toBeTruthy();
    expect(l.acquire('ip')).toBeNull(); // budget is held by the two in-flight attempts
    l.release(a); // one succeeded
    expect(l.acquire('ip')).not.toBeNull();
    expect(l.acquire('other')).not.toBeNull();
    // a refund from an older window generation must not touch the current one
    l.release({ key: 'ip', generation: -1 });
    expect(l.acquire('ip')).toBeNull();
  });
});
