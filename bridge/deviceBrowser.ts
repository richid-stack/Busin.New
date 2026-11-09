import fs from 'node:fs'
import type { BrowserContext } from 'playwright-core'
import { startGuardProxy, type GuardProxy } from '../server/utils/guardProxy'
import { installRouteGuard } from '../server/services/inspect/browser'
import { BROWSER_LIMITS, BrowserError } from '../server/services/browser/model'
import { BrowserSession } from '../server/services/browser/session'
import { LocalBrowserService } from '../server/services/browser/service'

/**
 * The browser OpenLobs uses on THIS computer: Edge or Chrome, in a browser profile of its own (never the one the
 * person browses with), so a site they signed in to once stays signed in, and nothing else of theirs is in it.
 *
 * It is the same engine as the hosted browser, with the same rules (the person is asked before anything that sends,
 * pays, deletes or posts; passwords and codes are never typed by the assistant; a stuck loop is stopped), plus these:
 *  - every connection the browser makes goes through a local guard that refuses private-network addresses (the
 *    router, the intranet, other machines) and this computer itself, at every redirect;
 *  - the profile is kept between sessions, and so are the browser's cookies, but the browser itself is closed after a while unused;
 *  - there is one session at a time: opening another replaces the first.
 */

export const DEVICE_BROWSER = {
  /** The browser process (and so the sign-ins that are only kept while it runs) is closed after this long with no session. */
  idleCloseMs: 60 * 60_000
}

export interface DeviceBrowserOptions {
  /** Where the profile lives. Created if missing. */
  profileDir: string
  /** Replaceable in tests. Starts the person's browser on the profile, with all traffic sent through the guard. */
  launch?: (profileDir: string, proxy: GuardProxy) => Promise<BrowserContext>
  idleCloseMs?: number
  /** Tests only: let pages on this machine be opened. The Bridge program never sets this. */
  allowLocal?: boolean
}

async function importPlaywright(): Promise<any> {
  const moduleName = 'playwright-core'
  try { return await import(/* @vite-ignore */ moduleName) } catch { throw new BrowserError('The browser part of the Bridge is not installed. Reinstall the Bridge.', 'failed') }
}

/** Starts Edge or Chrome (whichever the computer has) on the profile. `headed` shows the window, for signing in by hand. */
export async function launchProfile(profileDir: string, proxy: GuardProxy | null, headed: boolean): Promise<BrowserContext> {
  const playwright = await importPlaywright()
  const chromium = playwright.chromium ?? playwright.default?.chromium
  const executablePath = process.env.OPENLOBS_BROWSER_PATH || undefined
  fs.mkdirSync(profileDir, { recursive: true })
  const base = {
    headless: !headed,
    viewport: headed ? null : { ...BROWSER_LIMITS.viewport },
    acceptDownloads: false,
    serviceWorkers: 'block',
    permissions: [],
    locale: 'en-US',
    ...(proxy ? { proxy: { server: proxy.server, bypass: proxy.bypass } } : {})
  }
  try {
    if (executablePath) return await chromium.launchPersistentContext(profileDir, { ...base, executablePath, args: ['--no-sandbox'] })
    for (const channel of ['msedge', 'chrome']) {
      try { return await chromium.launchPersistentContext(profileDir, { ...base, channel }) } catch (err: any) {
        // A browser that is there but cannot use the profile (another window has it open) is a different problem from not being installed.
        if (/already in use|ProcessSingleton|user data directory/i.test(String(err?.message))) throw new BrowserError('The OpenLobs browser profile is open in another window. Close that window (or end the browser session in OpenLobs) and try again.', 'failed')
      }
    }
  } catch (err) {
    if (err instanceof BrowserError) throw err
    throw new BrowserError('The browser could not be started on this computer.', 'failed')
  }
  throw new BrowserError('Neither Microsoft Edge nor Google Chrome was found on this computer.', 'failed')
}

export class DeviceBrowser {
  readonly service: LocalBrowserService
  private context: BrowserContext | null = null
  private proxy: GuardProxy | null = null
  private starting: Promise<BrowserContext> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: DeviceBrowserOptions) {
    this.service = new LocalBrowserService({
      maxSessions: 1,
      start: async () => {
        this.cancelIdle()
        const context = await this.ensureContext()
        return await BrowserSession.attach(context, { sharedContext: true, allowLocal: this.options.allowLocal === true })
      }
    })
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context
    this.starting ??= (async () => {
      await this.proxy?.close()
      // Nothing on this computer or its network is reachable through the guard: only the public internet.
      const proxy = this.proxy = await startGuardProxy({ allowLocal: this.options.allowLocal === true })
      let context: BrowserContext
      try {
        context = await (this.options.launch ?? ((dir, p) => launchProfile(dir, p, false)))(this.options.profileDir, proxy)
      } catch (err) {
        await proxy.close().catch(() => {})
        this.proxy = null
        throw err
      }
      // The guard stays on for as long as the browser runs; it lives across sessions, so the per-session request count is not used.
      await installRouteGuard(context as never, this.options.allowLocal === true, 1_000_000)
      context.on('close', () => { if (this.context === context) this.context = null })
      this.context = context
      return context
    })().finally(() => { this.starting = null })
    return await this.starting
  }

  /** Call after a session may have ended: starts the countdown to closing the browser itself. */
  noteSessionMaybeEnded() {
    if (this.service.manager.count > 0 || !this.context || this.idleTimer) return
    this.idleTimer = setTimeout(() => { void this.closeBrowser() }, this.options.idleCloseMs ?? DEVICE_BROWSER.idleCloseMs)
    this.idleTimer.unref?.()
  }

  private cancelIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  /** Closes the browser process. The profile (cookies that have an expiry, local storage) stays on disk. */
  async closeBrowser() {
    this.cancelIdle()
    await this.service.manager.shutdown().catch(() => {})
    const c = this.context
    this.context = null
    await c?.close().catch(() => {})
    await this.proxy?.close().catch(() => {})
    this.proxy = null
  }
}
