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
  let key = `${scope}:${subject}`
  let max = limit

  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
    if (buckets.size >= MAX_BUCKETS) {
      // Full of live buckets. Never evict one (that would reset an active caller's count);
      // callers we have no room to track share one overflow bucket per scope instead.
      key = `${scope}:__overflow__`
      max = limit * 20
    }
  }

  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }

  bucket.count++
  if (bucket.count > max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    event.res.headers.set('Retry-After', String(retryAfter))
    throw new HTTPError({ statusCode: 429, statusMessage: `Too many requests. Try again in ${retryAfter}s.` })
  }
}

/**
 * The caller's address. `X-Forwarded-For` is client-controlled unless a trusted proxy writes it,
 * so it is only used with TRUSTED_PROXY_HOPS (the number of proxies in front of the app; default 1,
 * matching Cloud Run). The address appended by the nearest trusted proxy is picked counting from
 * the right, so a spoofed left-hand value is never used. Falls back to the socket address.
 */
export function clientAddress(event: H3Event): string {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10)
  const forwarded = event.req.headers.get('x-forwarded-for')
  if (hops > 0 && forwarded) {
    const chain = forwarded.split(',').map(part => part.trim()).filter(Boolean)
    const picked = chain[chain.length - hops]
    if (picked) return picked
  }
  return getRequestIP(event) || 'unknown'
}

/** Identifies the caller: the signed-in user id, otherwise the client address. */
export function rateLimitSubject(event: H3Event, userId?: string): string {
  return userId ? `u:${userId}` : `ip:${clientAddress(event)}`
}

export function resetRateLimits() {
  buckets.clear()
}
