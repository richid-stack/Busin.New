import dns from 'node:dns/promises'
import net from 'node:net'

/**
 * Looks at one web page with this computer's own Edge or Chrome and takes a picture. Read-only: it opens the
 * page in a fresh, empty browser (no saved logins, no cookies, nothing remembered afterwards), looks, and closes.
 * It never clicks, types or submits anything.
 *
 * This computer can reach things the internet cannot (a router page, a printer, a company intranet), so pages on
 * the private network are refused, and so is every request a page makes to one. Pages on this computer itself
 * (localhost) are allowed on purpose: that is how a site you are building gets checked.
 */

export class LookError extends Error {}

export interface LookInput { url: string, width: number, height: number, fullPage: boolean, colorScheme: 'light' | 'dark' }
export interface LookFacts { title: string, finalUrl: string, status: number | null, width: number, height: number, consoleErrors: string[], failedRequests: string[] }

export const LOOK_LIMITS = { navigationMs: 25_000, settleMs: 800, maxRequests: 400, maxFullPageHeight: 5000, maxBytes: 650_000, maxNotes: 10 }

// ---- The slice of Playwright used here, so tests can replace the browser ----
export interface RouteLike { request(): { url(): string }, continue(): Promise<void>, abort(reason?: string): Promise<void> }
export interface PageLike {
  goto(url: string, options: Record<string, unknown>): Promise<{ status(): number } | null>
  title(): Promise<string>
  url(): string
  waitForTimeout(ms: number): Promise<void>
  evaluate<T>(fn: () => T): Promise<T>
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>
  on(event: string, handler: (arg: any) => void): void
}
export interface ContextLike { newPage(): Promise<PageLike>, route(pattern: string, handler: (route: RouteLike) => Promise<void>): Promise<void>, close(): Promise<void> }
export interface BrowserLike { newContext(options: Record<string, unknown>): Promise<ContextLike>, close(): Promise<void> }

export interface LookDeps {
  launch?: () => Promise<BrowserLike>
  /** All addresses a host name points to. Replaceable in tests. */
  resolve?: (host: string) => Promise<string[]>
}

// ---- Addresses ----
const LOCAL_NAMES = /^(localhost)$/i

export function isLoopback(ip: string): boolean {
  const v = ip.toLowerCase()
  return v === '::1' || /^127\./.test(v) || v === '::ffff:127.0.0.1'
}

/** True for addresses that belong to a private network, not the public internet. Loopback is dealt with separately. */
export function isPrivateAddress(ip: string): boolean {
  let v = ip.toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) v = mapped[1]!
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number) as [number, number]
    return a === 0 || a === 10 || (a === 100 && b >= 64 && b <= 127) || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (net.isIPv6(v)) return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v)
  return true
}

const defaultResolve = async (host: string) => (await dns.lookup(host, { all: true })).map(a => a.address)

/** Whether a host may be visited: this computer, or somewhere on the public internet. */
export async function hostAllowed(rawHost: string, resolve: (h: string) => Promise<string[]> = defaultResolve): Promise<boolean> {
  const host = rawHost.replace(/^\[|\]$/g, '')
  if (LOCAL_NAMES.test(host)) return true
  if (net.isIP(host)) return isLoopback(host) || !isPrivateAddress(host)
  try {
    const addresses = await resolve(host)
    return addresses.length > 0 && addresses.every(a => isLoopback(a) ? false : !isPrivateAddress(a))
  } catch {
    return false
  }
}

export function parseTarget(raw: unknown): URL {
  let url: URL
  try { url = new URL(String(raw)) } catch { throw new LookError('That is not a valid web address.') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new LookError('Only http and https pages can be looked at.')
  if (url.username || url.password) throw new LookError('The web address must not contain a user name or password.')
  return url
}

export function parseLookInput(input: Record<string, unknown>): LookInput {
  const num = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(typeof v === 'number' && Number.isFinite(v) ? v : d)))
  return {
    url: parseTarget(input.url).toString(),
    width: num(input.width, 320, 1920, 1280),
    height: num(input.height, 320, 1600, 800),
    fullPage: input.fullPage === true,
    colorScheme: input.colorScheme === 'dark' ? 'dark' : 'light'
  }
}

// ---- The browser ----
async function defaultLaunch(): Promise<BrowserLike> {
  const moduleName = 'playwright-core'
  let playwright: any
  try { playwright = await import(/* @vite-ignore */ moduleName) } catch { throw new LookError('The browser part of the Bridge is not installed. Run "npm install" in the Bridge folder, then try again.') }
  const chromium = playwright.chromium ?? playwright.default?.chromium
  const executablePath = process.env.OPENLOBS_BROWSER_PATH || undefined
  if (executablePath) return await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] })
  // Edge is on every Windows computer; Chrome is on most. Either one works.
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ headless: true, channel }) } catch { /* try the next one */ }
  }
  throw new LookError('Neither Microsoft Edge nor Google Chrome was found on this computer.')
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** Opens the page, waits for it to settle, and returns a picture plus plain facts about how it behaved. */
export async function look(input: LookInput, signal: AbortSignal, deps: LookDeps = {}): Promise<{ image: Uint8Array, mediaType: 'image/jpeg', facts: LookFacts }> {
  const resolve = deps.resolve ?? defaultResolve
  const target = parseTarget(input.url)
  if (!(await hostAllowed(target.hostname, resolve))) throw new LookError('That address is on a private network, so the Bridge will not open it. Pages on this computer (localhost) and on the public internet are fine.')
  if (signal.aborted) throw new LookError('Cancelled.')

  const browser = await (deps.launch ?? defaultLaunch)()
  const stop = () => { browser.close().catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  try {
    const context = await browser.newContext({ viewport: { width: input.width, height: input.height }, colorScheme: input.colorScheme, acceptDownloads: false, serviceWorkers: 'block', permissions: [] })
    try {
      const verdicts = new Map<string, boolean>()
      let requests = 0
      const blocked = new Set<string>()
      await context.route('**/*', async (route) => {
        const raw = route.request().url()
        if (++requests > LOOK_LIMITS.maxRequests) return await route.abort('blockedbyclient')
        if (raw.startsWith('data:') || raw.startsWith('blob:') || raw === 'about:blank') return await route.continue()
        let ok = false
        try {
          const u = new URL(raw)
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            const key = `${u.protocol}//${u.host}`
            let v = verdicts.get(key)
            if (v === undefined) { v = await hostAllowed(u.hostname, resolve); verdicts.set(key, v) }
            ok = v
          }
        } catch { ok = false }
        if (!ok) blocked.add(raw)
        await (ok ? route.continue() : route.abort('blockedbyclient'))
      })

      const page = await context.newPage()
      const consoleErrors: string[] = []
      const failed: string[] = []
      const note = (list: string[], text: string) => { if (list.length < LOOK_LIMITS.maxNotes) list.push(clip(text, 200)) }
      page.on('console', (m: any) => { if (m.type?.() === 'error') note(consoleErrors, m.text?.() ?? '') })
      page.on('pageerror', (e: any) => note(consoleErrors, `Page error: ${e?.message ?? e}`))
      page.on('requestfailed', (r: any) => { const u = String(r.url?.() ?? ''); note(failed, blocked.has(u) ? `Blocked (private network): ${u}` : `Failed: ${u}`) })
      page.on('response', (r: any) => { const s = r.status?.(); if (typeof s === 'number' && s >= 400) note(failed, `${s}: ${r.url?.()}`) })

      let status: number | null = null
      try {
        const response = await page.goto(target.toString(), { waitUntil: 'load', timeout: LOOK_LIMITS.navigationMs })
        status = response?.status() ?? null
      } catch (err: any) {
        if (signal.aborted) throw new LookError('Cancelled.')
        throw new LookError(/timeout/i.test(String(err?.message)) ? 'The page took too long to load.' : 'The page could not be opened. Check the address and that the site is up.')
      }
      await page.waitForTimeout(LOOK_LIMITS.settleMs)
      // The page may have sent the browser somewhere else; that place is checked too.
      const finalUrl = page.url()
      if (finalUrl.startsWith('http')) {
        const f = new URL(finalUrl)
        if (!(await hostAllowed(f.hostname, resolve))) throw new LookError('The page sent the browser to a private network address, so the Bridge stopped.')
      }

      let height = input.height
      let options: Record<string, unknown> = { type: 'jpeg', quality: 72 }
      if (input.fullPage) {
        const full = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => input.height)
        height = Math.min(Math.max(input.height, Math.round(full) || input.height), LOOK_LIMITS.maxFullPageHeight)
        options = { ...options, fullPage: true, clip: { x: 0, y: 0, width: input.width, height } }
      }
      // Keep the picture small enough to send: lower the quality a step at a time instead of failing.
      let image = await page.screenshot(options)
      for (const quality of [55, 40, 28]) {
        if (image.length <= LOOK_LIMITS.maxBytes) break
        image = await page.screenshot({ ...options, quality })
      }
      if (image.length > LOOK_LIMITS.maxBytes) throw new LookError('The page is too large to send as one picture. Try the first screen only.')
      if (signal.aborted) throw new LookError('Cancelled.')
      return {
        image,
        mediaType: 'image/jpeg',
        facts: { title: clip(await page.title().catch(() => ''), 200), finalUrl: clip(finalUrl, 2000), status, width: input.width, height, consoleErrors, failedRequests: failed }
      }
    } finally {
      await context.close().catch(() => {})
    }
  } finally {
    signal.removeEventListener('abort', stop)
    await browser.close().catch(() => {})
  }
}
