import { checkRateLimit } from '../rateLimit'

export interface ToolLimits {
  /** Tool name, used as the rate-limit scope and in messages. */
  name: string
  userId: string
  perMinute: number
  timeoutMs: number
  /** Upper bound for the serialized result handed back to the model. */
  maxResultChars: number
}

/** Shrinks long strings anywhere inside a result until its JSON fits the budget. */
export function clampResult<T>(value: T, maxChars: number): T {
  const size = (v: unknown) => JSON.stringify(v ?? null).length
  if (size(value) <= maxChars) return value

  const shrink = (v: any, cap: number): any => {
    if (typeof v === 'string') return v.length > cap ? `${v.slice(0, cap)}… [cut]` : v
    if (Array.isArray(v)) return v.map(item => shrink(item, cap))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, shrink(val, cap)]))
    return v
  }

  let cap = Math.max(200, Math.floor(maxChars / 2))
  let out = shrink(value, cap)
  while (size(out) > maxChars && cap > 100) {
    cap = Math.floor(cap * 0.6)
    out = shrink(value, cap)
  }
  if (out && typeof out === 'object' && !Array.isArray(out)) out.truncated = true
  return out
}

/**
 * Wraps a tool body with the limits every tool shares: a per-user rate limit, a hard timeout,
 * and a bounded result. A tripped limit comes back as a normal failed result the model can explain,
 * never as a crash.
 */
export function withToolLimits<I, O extends object>(
  limits: ToolLimits,
  run: (input: I, signal: AbortSignal) => Promise<O>
) {
  return async (input: I, options?: { abortSignal?: AbortSignal }): Promise<O | { status: 'failed', error: string }> => {
    const gate = checkRateLimit(`tool:${limits.name}`, limits.userId, limits.perMinute, 60_000)
    if (!gate.ok) {
      return { status: 'failed', error: `The ${limits.name} tool is being used too quickly. Tell the user to wait ${gate.retryAfter} seconds.` }
    }

    // The timeout is enforced here (not only passed down), so a tool that ignores the signal is still cut off.
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new DOMException('timed out', 'TimeoutError')), limits.timeoutMs)
    const signal = AbortSignal.any([timeout.signal, ...(options?.abortSignal ? [options.abortSignal] : [])])
    const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    try {
      return clampResult(await Promise.race([run(input, signal), aborted]), limits.maxResultChars)
    } catch (err: any) {
      console.warn(`[tool:${limits.name}] failed:`, err?.message)
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      return {
        status: 'failed',
        error: timedOut
          ? `The ${limits.name} tool timed out. Tell the user it could not finish and do not guess the result.`
          : `The ${limits.name} tool failed: ${err?.message || 'unknown error'}. Tell the user, and do not guess the result.`
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
