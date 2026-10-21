/**
 * Tells the server when something breaks in the browser, so problems people hit are seen without
 * anyone having to report them. Small on purpose: a few reports per page load, no personal data.
 */
const MAX_REPORTS = 5
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /Non-Error promise rejection/i, /chrome-extension:|moz-extension:/i, /Failed to fetch|NetworkError|Load failed/i]

let reporter: ((kind: string, message: string, stack?: string) => void) | null = null

/** For errors Vue catches itself (they never reach window.onerror). */
export function reportClientError(err: unknown) {
  const e: any = err
  reporter?.('vue', e?.message || String(err ?? ''), e?.stack)
}

export function installErrorReporting() {
  if (typeof window === 'undefined' || (window as any).__errorReporting) return
  ;(window as any).__errorReporting = true

  const seen = new Set<string>()
  let sent = 0

  const report = (kind: string, message: string, stack?: string) => {
    if (sent >= MAX_REPORTS || !message || IGNORED.some(re => re.test(message) || (stack && /extension:/.test(stack)))) return
    const key = `${kind}:${message}`.slice(0, 300)
    if (seen.has(key)) return
    seen.add(key)
    sent++
    try {
      fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message: message.slice(0, 1000), stack: stack?.slice(0, 4000), page: location.pathname }),
        keepalive: true
      }).catch(() => {})
    } catch {
      // Reporting must never cause a problem of its own.
    }
  }

  reporter = report
  window.addEventListener('error', e => report('error', e.message, e.error?.stack))
  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = e.reason
    report('promise', reason?.message || String(reason ?? ''), reason?.stack)
  })
}
