/**
 * Fixed-window in-memory rate limiter for the login route (SPEC 42). Per
 * process, so best-effort on serverless; the fixed failure delay in the
 * route is the second brake. Keys are opaque strings (ip, user).
 *
 * The map is bounded: every hit drops the windows that have expired, and a
 * hard key cap evicts oldest-first behind that. Without both, a long-lived
 * instance keyed on caller-supplied strings grows until the function dies.
 */

export type RateLimiter = {
  hit(key: string): { allowed: boolean; retryAfterMs: number };
  reset(key: string): void;
  // Live key count. The bound is the point of the sweep, so it is readable.
  size(): number;
};

// One entry is a key plus two numbers; ten thousand of them is a bounded,
// unremarkable amount of memory for a login limiter.
export const MAX_KEYS = 10_000;

type Window = { start: number; count: number };

export function createRateLimiter(opts: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const windows = new Map<string, Window>();

  // Entries are re-inserted whenever their window starts, so Map insertion
  // order is window-start order: the expired ones are a prefix, and the
  // oldest key to evict is the first.
  function sweepExpired(t: number): void {
    for (const [key, w] of windows) {
      if (t - w.start < opts.windowMs) break;
      windows.delete(key);
    }
  }

  function open(key: string, t: number): void {
    windows.delete(key);
    windows.set(key, { start: t, count: 1 });
    while (windows.size > MAX_KEYS) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  }

  return {
    hit(key) {
      const t = now();
      sweepExpired(t);
      const w = windows.get(key);
      if (!w || t - w.start >= opts.windowMs) {
        open(key, t);
        return { allowed: true, retryAfterMs: 0 };
      }
      w.count += 1;
      if (w.count > opts.max) {
        return { allowed: false, retryAfterMs: w.start + opts.windowMs - t };
      }
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(key) {
      windows.delete(key);
    },
    size() {
      return windows.size;
    },
  };
}
