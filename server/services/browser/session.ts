import type { Browser, BrowserContext, Page } from 'playwright-core'
import { InspectError, checkTarget, installRouteGuard } from '../inspect/browser'
import { UnsafeUrlError } from '../../utils/netSafety'
import { GUARD_HEADER } from '../../utils/guardProxy'
import {
  BROWSER_LIMITS, BrowserError, actionSchema, needsOk, userInputSchema,
  type BrowserAction, type PageState, type UserInput
} from './model'
import { nameExpression, snapshotExpression } from './snapshot'

/**
 * One real browser session: its own cookies and tabs, driven one step at a time.
 *
 * What it will not do, whoever asks: reach a private address, download or upload a file, use the camera, microphone or
 * location, type into a password or card field, or do something that changes the world without the person's OK.
 * The page's words are returned as data. Nothing on a page can change these rules.
 */

export interface SessionOptions {
  /** Development only: allow pages on this machine. Never set on a hosted server. */
  allowLocal?: boolean
  now?: () => number
}

export interface ActResult {
  state: PageState
  /** True when the address changed. */
  navigated: boolean
}

export interface Frame {
  bytes: Buffer
  width: number
  height: number
  url: string
  title: string
  control: 'assistant' | 'person'
}

const safeProtocol = (url: string) => /^https?:/i.test(url) || url === 'about:blank'

export class BrowserSession {
  readonly createdAt: number
  lastUsed: number
  actions = 0
  /** Who holds the page: the assistant, or the person who took over. */
  control: 'assistant' | 'person' = 'assistant'
  last: PageState | null = null
  private pages: Page[] = []
  private page!: Page
  private notes: string[] = []
  private closed = false
  /** Set when the page's own navigation was refused or failed (a blocked address, a site that is down). */
  private failedNav = false
  /** The person held the page since the assistant last read it. */
  private unseen = false
  /** What the assistant had read when the person took the page. */
  private held: PageState | null = null
  private cached: { at: number, frame: Frame } | null = null
  private readonly now: () => number

  private constructor(private readonly context: BrowserContext, private readonly options: SessionOptions) {
    this.now = options.now ?? Date.now
    this.createdAt = this.lastUsed = this.now()
  }

  static async start(browser: Browser, options: SessionOptions = {}): Promise<BrowserSession> {
    const context = await browser.newContext({
      viewport: { ...BROWSER_LIMITS.viewport },
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: [],
      locale: 'en-US',
      javaScriptEnabled: true
    })
    const session = new BrowserSession(context, options)
    try {
      await installRouteGuard(context as never, options.allowLocal, 1500)
      context.on('page', (p) => { session.adopt(p) })
      session.adopt(await context.newPage())
    } catch (err) {
      await context.close().catch(() => {})
      throw err
    }
    return session
  }

  get isClosed() { return this.closed }
  expired(): string | null {
    const t = this.now()
    if (t - this.createdAt > BROWSER_LIMITS.maxLifeMs) return 'This browser session reached its time limit.'
    if (t - this.lastUsed > BROWSER_LIMITS.idleMs) return 'This browser session was closed after a while without use.'
    return null
  }

  private adopt(p: Page) {
    if (this.pages.includes(p)) return
    if (this.closed) return void p.close().catch(() => {})
    if (this.pages.length >= BROWSER_LIMITS.maxTabs) {
      this.notes.push('A new tab was blocked: too many are open.')
      return void p.close().catch(() => {})
    }
    this.pages.push(p)
    this.page = p
    p.on('dialog', (d) => {
      this.notes.push(`The page showed a ${d.type()}: “${d.message().slice(0, 160)}”.`)
      ;(d.type() === 'alert' ? d.accept() : d.dismiss()).catch(() => {})
    })
    p.on('download', (d) => {
      this.notes.push('The page tried to download a file. Downloads are blocked.')
      d.cancel().catch(() => {})
    })
    p.on('requestfailed', (r) => { if (r.isNavigationRequest() && r.frame() === p.mainFrame()) this.failedNav = true })
    p.on('response', (r) => { if (r.headers()[GUARD_HEADER] && r.request().isNavigationRequest() && r.frame() === p.mainFrame()) this.failedNav = true })
    p.on('close', () => {
      this.pages = this.pages.filter(x => x !== p)
      if (this.page === p) this.page = this.pages[this.pages.length - 1]!
    })
  }

  /** Does this action need the person's OK first? Decided here, from what is really on the page. */
  check(action: unknown): { ask: boolean, label: string } {
    const parsed = actionSchema.safeParse(action)
    if (!parsed.success) return { ask: false, label: '' }
    return needsOk(parsed.data, this.last)
  }

  /** One step at a time: the assistant can ask for two at once, and two hands on one page would trip over each other. */
  private queue: Promise<unknown> = Promise.resolve()
  act(input: unknown, opts: { approved?: boolean } = {}): Promise<ActResult> {
    const run = this.queue.then(() => this.step(input, opts))
    this.queue = run.catch(() => {})
    return run
  }

  private async step(input: unknown, opts: { approved?: boolean }): Promise<ActResult> {
    this.live()
    if (this.control === 'person') throw new BrowserError('The person is using the page right now. Wait for them to hand it back.', 'limit')
    const parsed = actionSchema.safeParse(input)
    if (!parsed.success) throw new BrowserError('That is not an action the browser can do.', 'bad_input')
    const action = parsed.data
    if (++this.actions > BROWSER_LIMITS.maxActions) throw new BrowserError('This session reached its limit of steps. Start again if the job is not finished.', 'limit')
    // The person had the page since the assistant last read it, so its numbers may mean something else now. A step on a
    // control that is still the same control (same kind, same words) goes ahead; anything else needs a fresh read first.
    if (this.unseen && !['read', 'open', 'scroll', 'back', 'wait'].includes(action.action)) {
      const before = 'ref' in action ? this.held?.elements.find(e => e.ref === action.ref) : undefined
      const now = 'ref' in action ? this.last?.elements.find(e => e.ref === action.ref) : undefined
      if (!before || !now || before.name !== now.name || before.role !== now.role) throw new BrowserError('The page was in the person\'s hands since you last read it. Read the page again before the next step.', 'failed')
    }
    if (action.action === 'read' || action.action === 'open') this.unseen = false
    const gate = needsOk(action, this.last)
    if (gate.ask && !opts.approved) throw new BrowserError(`The person has not approved this step: ${gate.label}.`, 'unsafe')

    const before = this.page.url()
    this.failedNav = false
    await this.run(action)
    const state = await this.read()
    return { state, navigated: state.url !== before }
  }

  /** What the person does with their own hands. Never read back, never stored. */
  async input(raw: unknown): Promise<void> {
    this.live()
    if (this.control !== 'person') throw new BrowserError('Take over the page first.', 'limit')
    const parsed = userInputSchema.safeParse(raw)
    if (!parsed.success) throw new BrowserError('That is not something you can do on the page.', 'bad_input')
    const i: UserInput = parsed.data
    const { width, height } = BROWSER_LIMITS.viewport
    if (i.kind === 'click') await this.page.mouse.click(Math.min(i.x, width - 1), Math.min(i.y, height - 1), { delay: 30 })
    else if (i.kind === 'type') await this.page.keyboard.type(i.text, { delay: 12 })
    else if (i.kind === 'key') await this.page.keyboard.press(i.key)
    else { await this.page.mouse.move(width / 2, height / 2); await this.page.mouse.wheel(0, i.dy) }
    await this.page.waitForTimeout(150)
    this.cached = null
    await this.guardUrl()
  }

  takeOver() { this.live(); this.control = 'person'; this.unseen = true; this.held = this.last; this.cached = null }
  /** Hands the page back and re-reads it, because the person may have changed it. */
  async handBack(): Promise<PageState> { this.live(); this.control = 'assistant'; return await this.read() }

  async frame(): Promise<Frame> {
    this.live()
    if (this.cached && this.now() - this.cached.at < 250) return this.cached.frame
    const bytes = await this.page.screenshot({ type: 'jpeg', quality: 60, timeout: 6000 })
    const frame: Frame = {
      bytes, ...BROWSER_LIMITS.viewport, url: this.safeUrl(), title: (await this.page.title().catch(() => '')).slice(0, 200), control: this.control
    }
    this.cached = { at: this.now(), frame }
    return frame
  }

  /** Where the page is, cheaply (no picture). */
  async info(): Promise<{ url: string, title: string }> {
    return { url: this.safeUrl(), title: (await this.page.title().catch(() => '')).slice(0, 200) }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.context.close().catch(() => {})
  }

  // ---- inside -------------------------------------------------------------------------------------------------

  private live() {
    if (this.closed) throw new BrowserError('This browser session is closed.', 'not_found')
    const reason = this.expired()
    if (reason) throw new BrowserError(reason, 'limit')
    this.lastUsed = this.now()
  }

  private safeUrl(): string {
    const url = this.page.url()
    return safeProtocol(url) ? url : 'about:blank'
  }

  /** Never stay on a page that is not an ordinary web page. */
  private async guardUrl() {
    const url = this.page.url()
    if (safeProtocol(url) && !this.failedNav) return
    const failed = this.failedNav || url.startsWith('chrome-error:')
    this.failedNav = false
    await this.page.goto('about:blank').catch(() => {})
    if (failed) throw new BrowserError('The page could not be opened. It may be down, or not allowed.', 'failed')
    throw new BrowserError('That kind of address cannot be opened.', 'unsafe')
  }

  private async settle() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {})
    await this.page.waitForLoadState('load', { timeout: 3000 }).catch(() => {})
    await this.page.waitForTimeout(BROWSER_LIMITS.settleMs)
  }

  /** What the page looks like now. Retries once or twice when the page was in the middle of changing. */
  async read(): Promise<PageState> {
    this.cached = null
    for (let i = 0; i < 3; i++) {
      try {
        const raw = await this.page.evaluate(snapshotExpression()) as Omit<PageState, 'dialogs' | 'tabs'>
        const state: PageState = { ...raw, dialogs: this.notes.splice(0), tabs: this.pages.length }
        if (!safeProtocol(state.url)) throw new BrowserError('That kind of address cannot be opened.', 'unsafe')
        this.last = state
        return state
      } catch (err) {
        if (err instanceof BrowserError) throw err
        await this.page.waitForTimeout(250)
      }
    }
    await this.guardUrl()
    throw new BrowserError('The page could not be read. Try again.', 'failed')
  }

  private element(ref: number) {
    const known = this.last?.elements.find(e => e.ref === ref)
    if (!known) throw new BrowserError(`Element ${ref} is not on the page. Read the page again to see what is there now.`, 'not_found')
    return known
  }

  /** The words on the live element, to be sure it is still the one the assistant (and the person) saw. */
  private async stillThere(ref: number, name: string) {
    const live = await this.page.evaluate(nameExpression(ref)).catch(() => null) as string | null
    if (live === null) throw new BrowserError(`Element ${ref} is gone. Read the page again.`, 'not_found')
    const a = name.replace(/…$/, '').toLowerCase()
    const b = live.toLowerCase()
    if (a && b && !(a.includes(b) || b.includes(a) || a.slice(0, 12) === b.slice(0, 12))) {
      await this.read().catch(() => {})
      throw new BrowserError('The page changed under that step, so it was not done. Read the page again.', 'failed')
    }
  }

  private async run(action: BrowserAction) {
    const page = this.page
    const t = BROWSER_LIMITS.actionMs
    try {
      switch (action.action) {
        case 'open': {
          const target = checkTarget(action.url, this.options.allowLocal)
          try {
            await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: BROWSER_LIMITS.navigationMs })
          } catch (err: any) {
            await this.guardUrl()
            throw new BrowserError(/timeout/i.test(String(err?.message)) ? 'The page took too long to load.' : 'The page could not be opened. Check the address and that the site is up.', 'failed')
          }
          await this.settle()
          break
        }
        case 'read': break
        case 'click': {
          const el = this.element(action.ref)
          if (el.disabled) throw new BrowserError(`“${el.name}” is disabled.`, 'bad_input')
          await this.stillThere(action.ref, el.name)
          await page.locator(`[data-olref="${action.ref}"]`).first().click({ timeout: t })
          await this.settle()
          if (this.page !== page) await this.settle()
          break
        }
        case 'type': {
          const el = this.element(action.ref)
          if (el.sensitive) throw new BrowserError('This is a password, code or payment field. The assistant never types in these. Ask the person to take over and fill it in themselves.', 'unsafe')
          if (el.role !== 'textbox' && el.role !== 'combobox') throw new BrowserError(`“${el.name}” is not a place to type.`, 'bad_input')
          const loc = page.locator(`[data-olref="${action.ref}"]`).first()
          await loc.fill(action.text, { timeout: t }).catch(async () => {
            await loc.click({ timeout: t })
            await page.keyboard.press('Control+A')
            await page.keyboard.type(action.text, { delay: 5 })
          })
          if (action.submit) { await page.keyboard.press('Enter'); await this.settle() } else await page.waitForTimeout(200)
          break
        }
        case 'select': {
          const el = this.element(action.ref)
          if (el.role !== 'select') throw new BrowserError(`“${el.name}” is not a choice list.`, 'bad_input')
          const loc = page.locator(`[data-olref="${action.ref}"]`).first()
          await loc.selectOption({ label: action.value }, { timeout: t }).catch(() => loc.selectOption(action.value, { timeout: t }))
          await page.waitForTimeout(200)
          break
        }
        case 'press':
          await page.keyboard.press(action.key)
          await this.settle()
          break
        case 'scroll': {
          const { width, height } = BROWSER_LIMITS.viewport
          await page.mouse.move(width / 2, height / 2)
          await page.mouse.wheel(0, (action.direction === 'down' ? 1 : -1) * (action.amount ?? 600))
          await page.waitForTimeout(300)
          break
        }
        case 'back': {
          const r = await page.goBack({ timeout: BROWSER_LIMITS.navigationMs, waitUntil: 'domcontentloaded' }).catch(() => null)
          if (!r) throw new BrowserError('There is nothing to go back to.', 'bad_input')
          await this.settle()
          break
        }
        case 'wait':
          await page.waitForTimeout(action.ms)
          break
      }
    } catch (err: any) {
      if (err instanceof BrowserError) throw err
      if (err instanceof UnsafeUrlError || err instanceof InspectError) throw new BrowserError(err.message, 'unsafe')
      if (/timeout/i.test(String(err?.message))) throw new BrowserError('That took too long. The page may not have that control, or it may be covered. Read the page and try again.', 'failed')
      throw new BrowserError('The browser could not do that. Read the page and try again.', 'failed')
    }
    await this.guardUrl()
  }
}

/** True when this address could be opened at all (used by callers that want to refuse early). */
export const canOpen = (raw: string, allowLocal = false) => {
  try { checkTarget(raw, allowLocal); return true } catch { return false }
}
