/**
 * Tiny fixed-window rate limiter for the password endpoints. In-memory on
 * purpose: one process, one party, and a restart resetting the counters is
 * acceptable.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

/** Returns seconds to wait when blocked, or 0 when the attempt may proceed. */
export function attemptDelay(key: string, now = Date.now()): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return 0;
  }
  if (b.count >= MAX_ATTEMPTS) {
    return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  }
  b.count++;
  return 0;
}

/** Call after a successful login so legitimate users aren't penalized. */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}
