import { UnsafeUrlError, parseSafeUrl, resolvesToPublicOnly } from '../../utils/netSafety'

/**
 * Takes a screenshot of a web page with a real browser (Playwright). It runs either inside the screenshot
 * worker (a separate service, see docs/deploy.md) or, for development, in the app itself.
 *
 * Every request the page makes is checked, not only the first address: a page can load frames, images and
 * scripts from anywhere, and none of them may reach a private address.
 */

export interface ScreenshotRequest {
  url: string
  width?: number
  height?: number
  fullPage?: boolean
  /** Extra time to let the page settle after it loads. */
  waitMs?: number
  colorScheme?: 'light' | 'dark'
}

export interface Screenshot {
  bytes: Uint8Array
  mediaType: 'image/jpeg'
  width: number
  height: number
  url: string
  title: string
  /** How the page behaved, when the browser could tell (a computer's own browser does). */
  facts?: { status: number | null, consoleErrors: string[], failedRequests: string[], computer: string }
}

export class InspectError extends Error {}

export const LIMITS = { minSize: 320, maxWidth: 1920, maxHeight: 1600, maxFullPageHeight: 5000, maxWaitMs: 5000, navigationMs: 25_000, maxRequests: 400 }

/** The slice of Playwright used here, so the browser can be replaced in tests. */
export interface BrowserLike {
  newContext(options: Record<string, unknown>): Promise<ContextLike>
  close(): Promise<void>
}
export interface ContextLike {
  newPage(): Promise<PageLike>
  route(pattern: string, handler: (route: RouteLike) => Promise<void>): Promise<void>
  close(): Promise<void>
}
export interface RouteLike { request(): { url(): string }, continue(): Promise<void>, abort(reason?: string): Promise<void> }
export interface PageLike {
  goto(url: string, options: Record<string, unknown>): Promise<unknown>
  title(): Promise<string>
  url(): string
  waitForTimeout(ms: number): Promise<void>
  evaluate<T>(fn: () => T): Promise<T>
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>
}

export interface BrowserOptions {
  /** Development only: allow pages on this machine (localhost). Never set on a hosted server. */
  allowLocal?: boolean
  launch?: () => Promise<BrowserLike>
}

const clamp = (n: number | undefined, lo: number, hi: number, fallback: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n as number) ? (n as number) : fallback)))

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)

/** Checks the address the person gave. Local pages pass only when development mode says so. */
export function checkTarget(raw: string, allowLocal = false): URL {
  if (allowLocal) {
    let url: URL | null = null
    try { url = new URL(raw) } catch { /* handled below */ }
    if (url && (url.protocol === 'http:' || url.protocol === 'https:') && isLocalHost(url.hostname) && !url.username && !url.password) return url
  }
  try {
    return parseSafeUrl(raw)
  } catch (err) {
    throw new InspectError(err instanceof UnsafeUrlError ? err.message : 'That is not a valid web address.')
  }
}

async function defaultLaunch(): Promise<BrowserLike> {
  const moduleName = 'playwright-core'
  let playwright: any
  try {
    playwright = await import(/* @vite-ignore */ moduleName)
  } catch {
    throw new InspectError('The screenshot browser is not installed on this server.')
  }
  const executablePath = process.env.INSPECTOR_CHROMIUM_PATH || undefined
  return await (playwright.chromium ?? playwright.default?.chromium).launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
}

export async function captureScreenshot(req: ScreenshotRequest, options: BrowserOptions = {}): Promise<Screenshot> {
  const target = checkTarget(req.url, options.allowLocal)
  const width = clamp(req.width, LIMITS.minSize, LIMITS.maxWidth, 1280)
  const height = clamp(req.height, LIMITS.minSize, LIMITS.maxHeight, 800)
  const waitMs = clamp(req.waitMs, 0, LIMITS.maxWaitMs, 800)

  const browser = await (options.launch ?? defaultLaunch)()
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: req.colorScheme ?? 'light',
      javaScriptEnabled: true,
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: []
    })
    try {
      const seen = new Map<string, boolean>()
      let requests = 0
      await context.route('**/*', async (route) => {
        const raw = route.request().url()
        // A page that makes endless requests is not a page worth waiting for.
        if (++requests > LIMITS.maxRequests) return await route.abort('blockedbyclient')
        if (raw.startsWith('data:') || raw.startsWith('blob:') || raw === 'about:blank') return await route.continue()
        let ok = seen.get(new URL(raw, 'http://x').origin)
        if (ok === undefined) {
          try {
            const url = options.allowLocal && isLocalHost(new URL(raw).hostname) ? new URL(raw) : parseSafeUrl(raw)
            ok = isLocalHost(url.hostname) ? true : await resolvesToPublicOnly(url.hostname)
          } catch {
            ok = false
          }
          seen.set(new URL(raw).origin, ok)
        }
        await (ok ? route.continue() : route.abort('blockedbyclient'))
      })

      const page = await context.newPage()
      try {
        await page.goto(target.toString(), { waitUntil: 'load', timeout: LIMITS.navigationMs })
      } catch (err: any) {
        throw new InspectError(/timeout/i.test(String(err?.message)) ? 'The page took too long to load.' : 'The page could not be opened. Check the address and that the site is up.')
      }
      if (waitMs) await page.waitForTimeout(waitMs)

      // A whole page can be enormous; take it in full only up to a limit, so one tall page cannot use all the memory.
      let shot: Record<string, unknown> = { type: 'jpeg', quality: 72 }
      let shotHeight = height
      if (req.fullPage) {
        const full = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => height)
        shotHeight = Math.min(Math.max(height, Math.round(full) || height), LIMITS.maxFullPageHeight)
        shot = { ...shot, fullPage: true, clip: { x: 0, y: 0, width, height: shotHeight } }
      }
      const bytes = await page.screenshot(shot)
      return { bytes, mediaType: 'image/jpeg', width, height: shotHeight, url: page.url(), title: (await page.title().catch(() => '')).slice(0, 200) }
    } finally {
      await context.close().catch(() => {})
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
