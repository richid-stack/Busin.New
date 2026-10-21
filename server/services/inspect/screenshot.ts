import { InspectError, captureScreenshot, checkTarget } from './browser'
import type { Screenshot, ScreenshotRequest } from './browser'

/**
 * Where screenshots come from. In production a separate worker service runs the browser (so the app stays
 * small and a browser crash cannot take the app down); in development the app can run the browser itself.
 */
export interface ScreenshotProvider {
  capture(req: ScreenshotRequest, signal?: AbortSignal): Promise<Screenshot>
}

export const MAX_IMAGE_BYTES = 6_000_000

export interface RemoteOptions { url: string, secret: string, fetch?: typeof fetch }

/** Calls the screenshot worker. The address is checked here too, so a bad one never leaves the app. */
export function remoteProvider(opts: RemoteOptions): ScreenshotProvider {
  const f = opts.fetch ?? fetch
  return {
    async capture(req, signal) {
      const target = checkTarget(req.url, false)
      let res: Response
      try {
        res = await f(`${opts.url.replace(/\/+$/, '')}/screenshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.secret}` },
          body: JSON.stringify({ ...req, url: target.toString() }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
          redirect: 'error'
        })
      } catch {
        throw new InspectError('The screenshot service could not be reached. Try again in a moment.')
      }
      const text = await res.text().catch(() => '')
      let body: any = null
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      if (!res.ok) {
        // The worker's own messages are written for people; anything else is not shown.
        const message = res.status === 400 && typeof body?.error === 'string' ? body.error : 'The screenshot service could not take the picture.'
        throw new InspectError(String(message).slice(0, 300))
      }
      if (!body || typeof body.imageBase64 !== 'string' || text.length > MAX_IMAGE_BYTES * 1.4) throw new InspectError('The screenshot service sent something unreadable.')
      const bytes = Buffer.from(body.imageBase64, 'base64')
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new InspectError('The screenshot came back empty or too large.')
      return { bytes, mediaType: 'image/jpeg', width: Number(body.width) || 0, height: Number(body.height) || 0, url: String(body.url || target), title: String(body.title || '').slice(0, 200) }
    }
  }
}

/** For development: runs the browser inside the app. Pages on this machine are allowed only here, and never when NODE_ENV is production. */
export function localProvider(): ScreenshotProvider {
  return { capture: req => captureScreenshot(req, { allowLocal: process.env.NODE_ENV !== 'production' && process.env.INSPECT_ALLOW_LOCAL === '1' }) }
}

/** The configured provider, or null when screenshots are not set up here. */
export function defaultProvider(env: NodeJS.ProcessEnv = process.env): ScreenshotProvider | null {
  if (env.INSPECTOR_URL && env.INSPECTOR_SECRET) return remoteProvider({ url: env.INSPECTOR_URL, secret: env.INSPECTOR_SECRET })
  if (env.INSPECTOR_LOCAL === '1' && env.NODE_ENV !== 'production') return localProvider()
  return null
}
