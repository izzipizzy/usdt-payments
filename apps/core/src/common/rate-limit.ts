import { Injectable } from '@nestjs/common';

export interface AttemptReservation {
  key: string;
  generation: number;
}

/**
 * Per-key fixed-window budget of authentication ATTEMPTS. A slot is reserved before the (async) credential check
 * and given back once the caller is authenticated, so a concurrent burst cannot slip past a "check first, count
 * later" gate and a legitimate operator's own successful requests never eat the budget. A reservation remembers
 * its window generation and is only refunded against that window. Once an IP has `max` outstanding-or-failed
 * attempts in the window every request from it gets 429 until the window rolls (including requests with a valid
 * credential — that lockout is the point). Per process; multi-replica deployments need a Redis-backed variant.
 */
export class FixedWindowAttemptLimiter {
  private windowStart = Date.now();
  private generation = 0;
  private counts = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private roll(): void {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.generation++;
      this.counts.clear();
    }
  }

  /** Reserve one attempt; null when the budget is exhausted. */
  acquire(key: string): AttemptReservation | null {
    this.roll();
    const n = this.counts.get(key) ?? 0;
    if (n >= this.max) return null;
    this.counts.set(key, n + 1);
    return { key, generation: this.generation };
  }

  /** Give a slot back (successful authentication). No-op when the window has rolled since the reservation. */
  release(r: AttemptReservation | null): void {
    if (!r) return;
    this.roll();
    if (r.generation !== this.generation) return;
    const n = this.counts.get(r.key) ?? 0;
    if (n > 0) this.counts.set(r.key, n - 1);
  }
}

/** Shared by the admin guard and the login/setup endpoints: 20 failed attempts per IP per minute. */
@Injectable()
export class AuthFailureLimiter extends FixedWindowAttemptLimiter {
  constructor() {
    super(20, 60_000);
  }
}
