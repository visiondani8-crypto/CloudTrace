/**
 * In-memory fixed-window rate limiter for local development. A production
 * deployment needs a shared store (e.g. Redis) — documented in IMPLEMENTATION_NOTES.md.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  bucket.count++;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
  };
}

export function resetRateLimits() {
  buckets.clear();
}

export const LIMITS = {
  signInPerEmail: { limit: 8, windowMs: 15 * 60 * 1000 },
  signInPerIp: { limit: 40, windowMs: 15 * 60 * 1000 },
  analyzePerUser: { limit: 12, windowMs: 10 * 60 * 1000 },
  syncPerOrg: { limit: 6, windowMs: 10 * 60 * 1000 },
  importPerUser: { limit: 30, windowMs: 10 * 60 * 1000 },
} as const;
