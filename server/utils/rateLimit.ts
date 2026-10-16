import type { H3Event } from 'nitro'
import { HTTPError } from 'nitro'
import { getRequestIP } from 'nitro/h3'

interface Bucket { count: number, resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

/**
 * Fixed-window rate limiter held in this server instance's memory. It protects the AI quota from
 * a single noisy client; with several instances the effective limit is per instance.
 * Throws 429 with Retry-After when the limit is exceeded.
 */
export function enforceRateLimit(event: H3Event, scope: string, subject: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const key = `${scope}:${subject}`

  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
    // Still full of live buckets: drop the oldest so memory stays bounded.
    if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value as string)
  }

  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }

  bucket.count++
  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    event.res.headers.set('Retry-After', String(retryAfter))
    throw new HTTPError({ statusCode: 429, statusMessage: `Too many requests. Try again in ${retryAfter}s.` })
  }
}

/** Identifies the caller: the signed-in user id, otherwise the client IP. */
export function rateLimitSubject(event: H3Event, userId?: string): string {
  return userId ? `u:${userId}` : `ip:${getRequestIP(event, { xForwardedFor: true }) || 'unknown'}`
}

export function resetRateLimits() {
  buckets.clear()
}
