import type { Browser } from 'playwright-core'
import { startGuardProxy, type GuardProxy } from '../../utils/guardProxy'
import { BROWSER_LIMITS, BrowserError } from './model'
import { BrowserSession, type SessionOptions } from './session'

/**
 * Holds the live browser sessions on one machine: one per key (a person's chat), a limit on how many run at once, and
 * a sweep that closes any that have idled or run too long. One shared browser process, one isolated context each.
 */
export interface ManagerOptions extends SessionOptions {
  maxSessions?: number
  /** Starts the browser pointed at the guard proxy. The default starts Chromium. */
  launch?: (proxy: GuardProxy) => Promise<Browser>
}

export class BrowserManager {
  private browser: Browser | null = null
  private proxy: GuardProxy | null = null
  private launching: Promise<Browser> | null = null
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly pending = new Map<string, Promise<BrowserSession>>()
  private sweeper: ReturnType<typeof setInterval> | null = null
  private readonly max: number

  constructor(private readonly options: ManagerOptions = {}) {
    this.max = options.maxSessions ?? 3
  }

  private async engine(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser
    this.launching ??= (async () => {
      await this.proxy?.close()
      const proxy = this.proxy = await startGuardProxy({ allowLocal: this.options.allowLocal })
      const b = await (this.options.launch ?? defaultLaunch)(proxy)
      this.browser = b
      b.on('disconnected', () => { this.browser = null; this.sessions.clear() })
      return b
    })().finally(() => { this.launching = null })
    return await this.launching
  }

  /** The session for this key, started if there is none. */
  async open(key: string): Promise<BrowserSession> {
    await this.sweep()
    const have = this.sessions.get(key)
    if (have && !have.isClosed && !have.expired()) return have
    if (have) await this.drop(key)
    const racing = this.pending.get(key)
    if (racing) return await racing
    if (this.sessions.size + this.pending.size >= this.max) throw new BrowserError('The browser is busy with other sessions. Try again in a minute.', 'limit')
    const starting = (async () => {
      const session = await BrowserSession.start(await this.engine(), this.options)
      this.sessions.set(key, session)
      this.watch()
      return session
    })().finally(() => this.pending.delete(key))
    this.pending.set(key, starting)
    return await starting
  }

  /** The live session for this key, or null. Never starts one. */
  get(key: string): BrowserSession | null {
    const s = this.sessions.get(key)
    return s && !s.isClosed && !s.expired() ? s : null
  }

  get count() { return this.sessions.size }

  async drop(key: string): Promise<void> {
    const s = this.sessions.get(key)
    this.sessions.delete(key)
    await s?.close()
  }

  async sweep(): Promise<void> {
    for (const [key, s] of [...this.sessions]) if (s.isClosed || s.expired()) await this.drop(key)
  }

  private watch() {
    if (this.sweeper) return
    this.sweeper = setInterval(() => { void this.sweep() }, 30_000)
    this.sweeper.unref?.()
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    for (const key of [...this.sessions.keys()]) await this.drop(key)
    const b = this.browser
    this.browser = null
    await b?.close().catch(() => {})
    await this.proxy?.close()
    this.proxy = null
  }
}

async function defaultLaunch(proxy: GuardProxy): Promise<Browser> {
  const moduleName = 'playwright-core'
  let playwright: any
  try {
    playwright = await import(/* @vite-ignore */ moduleName)
  } catch {
    throw new BrowserError('The browser is not installed on this server.', 'failed')
  }
  const executablePath = process.env.INSPECTOR_CHROMIUM_PATH || process.env.OPENLOBS_BROWSER_PATH || undefined
  return await (playwright.chromium ?? playwright.default?.chromium).launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'], proxy: { server: proxy.server, bypass: proxy.bypass } })
}

export { BROWSER_LIMITS }
