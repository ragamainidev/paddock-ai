import { describe, expect, it } from 'vitest';
import { createRateLimiter, MAX_KEYS } from './rate-limit';

describe('rate limiter', () => {
  it('allows max hits per window, then refuses with a retry hint', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect(rl.hit('k').allowed).toBe(true);
    expect(rl.hit('k').allowed).toBe(true);
    expect(rl.hit('k').allowed).toBe(true);
    const fourth = rl.hit('k');
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBe(1000);
    t = 1001;
    expect(rl.hit('k').allowed).toBe(true);
  });

  it('keys are independent and reset clears one', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(rl.hit('a').allowed).toBe(true);
    expect(rl.hit('b').allowed).toBe(true);
    expect(rl.hit('a').allowed).toBe(false);
    rl.reset('a');
    expect(rl.hit('a').allowed).toBe(true);
  });

  it('sweeps windows that have expired instead of keeping every key seen', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    for (const key of ['a', 'b', 'c']) rl.hit(key);
    expect(rl.size()).toBe(3);

    t = 1001;
    rl.hit('d');
    // The three expired windows go with the hit that outlived them.
    expect(rl.size()).toBe(1);
    // And the sweep is not a reset in disguise: the new window still counts.
    rl.hit('d');
    rl.hit('d');
    expect(rl.hit('d').allowed).toBe(false);
  });

  it('caps the key count, evicting the oldest window first', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now: () => t });
    for (let i = 0; i < MAX_KEYS + 5; i++) {
      t = i; // distinct, increasing window starts inside one window length
      rl.hit(`key-${i}`);
    }
    expect(rl.size()).toBe(MAX_KEYS);
    // The newest key is still counted; the oldest was evicted, so it reads
    // as a first hit again.
    expect(rl.hit(`key-${MAX_KEYS + 4}`).allowed).toBe(false);
    expect(rl.hit('key-0').allowed).toBe(true);
  });
});
