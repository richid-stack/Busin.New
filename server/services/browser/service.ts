import { timingSafeEqual } from 'node:crypto'
import { BROWSER_LIMITS, BrowserError, actionSchema, userInputSchema, type BrowserAction, type PageState, type UserInput } from './model'
import { BrowserManager, type ManagerOptions } from './manager'
import type { ActResult, Frame } from './session'
import { frameFromHeaders } from './frameWire'

/**
 * What the app needs from a browser, wherever it runs: on a hosted worker (the default), in the app itself (development),
 * and later on a person's own computer through the Bridge. Sessions are addressed by a key the app builds from the person
 * and the chat, so one person's page can never be reached with another's key.
 */
export interface SessionStatus {
  url: string
  title: string
  control: 'assistant' | 'person'
  actions: number
  /** Milliseconds until the session closes if nobody uses it. */
  idleLeftMs: number
  /** Milliseconds left of a wait for the person (0 when the page is not waiting). */
  holdLeftMs: number
  /** How long ago someone last looked at the live picture; null if nobody has. Tells whether the person is here. */
  viewedAgoMs: number | null
}

export interface BrowserService {
  /** Does this step need the person's OK first? Never starts a browser. */
  check(key: string, action: BrowserAction): Promise<{ ask: boolean, label: string }>
  /** Does the step. `open` starts the session if there is none. */
  act(key: string, action: BrowserAction, opts?: { approved?: boolean, signal?: AbortSignal }): Promise<ActResult>
  status(key: string): Promise<SessionStatus | null>
  frame(key: string): Promise<Frame | null>
  takeOver(key: string): Promise<void>
  handBack(key: string): Promise<PageState>
  input(key: string, input: UserInput): Promise<void>
  /** Keeps the page open while it waits for the person, up to the longest wait. A step or taking over ends the wait. */
  hold(key: string, ms: number): Promise<void>
  close(key: string): Promise<void>
}

/** The key for one person's chat. Built here only, so nothing else decides who a session belongs to. */
export const browserKey = (userId: string, chatId: string) => `${userId}:${chatId}`.slice(0, 200)
export const validKey = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9:_.-]{3,200}$/.test(key)

// ---- In this process --------------------------------------------------------------------------------------------

export class LocalBrowserService implements BrowserService {
  readonly manager: BrowserManager
  constructor(options: ManagerOptions = {}) { this.manager = new BrowserManager(options) }

  async check(key: string, action: BrowserAction) {
    return this.manager.get(key)?.check(action) ?? { ask: false, label: '' }
  }

  async act(key: string, action: BrowserAction, opts: { approved?: boolean } = {}) {
    const parsed = actionSchema.safeParse(action)
    if (!parsed.success) throw new BrowserError('That is not an action the browser can do.', 'bad_input')
    if (parsed.data.action !== 'open' && !this.manager.get(key)) throw new BrowserError('No page is open. Open a web address first.', 'not_found')
    const session = await this.manager.open(key)
    return await session.act(parsed.data, opts)
  }

  async status(key: string): Promise<SessionStatus | null> {
    const s = this.manager.get(key)
    if (!s) return null
    const info = await s.info()
    return { url: info.url, title: info.title, control: s.control, actions: s.actions, idleLeftMs: Math.max(0, BROWSER_LIMITS.idleMs - (Date.now() - s.lastUsed)), holdLeftMs: info.holdLeftMs, viewedAgoMs: info.viewedAgoMs }
  }

  async frame(key: string) {
    // Looking at the page does not keep it alive: only a person or the assistant using it does.
    const s = this.manager.get(key)
    if (!s) return null
    const keep = s.lastUsed
    try {
      return await s.frame()
    } catch {
      // The page is there but could not be photographed just now (it was navigating). That is not "closed".
      throw new BrowserError('The page could not be shown just now.', 'failed')
    } finally {
      s.lastUsed = keep
    }
  }

  private session(key: string) {
    const s = this.manager.get(key)
    if (!s) throw new BrowserError('There is no browser open for this chat.', 'not_found')
    return s
  }
  async takeOver(key: string) { this.session(key).takeOver() }
  async handBack(key: string) { return await this.session(key).handBack() }
  async input(key: string, input: UserInput) {
    const parsed = userInputSchema.safeParse(input)
    if (!parsed.success) throw new BrowserError('That is not something you can do on the page.', 'bad_input')
    await this.session(key).input(parsed.data)
  }
  async hold(key: string, ms: number) { this.session(key).hold(ms) }
  async close(key: string) { await this.manager.drop(key) }
}

// ---- Over HTTP to the worker ------------------------------------------------------------------------------------

export interface RemoteOptions { url: string, secret: string, fetch?: typeof fetch }

export class RemoteBrowserService implements BrowserService {
  private readonly f: typeof fetch
  constructor(private readonly opts: RemoteOptions) { this.f = opts.fetch ?? fetch }

  private async call(path: string, body: unknown, signal?: AbortSignal, timeoutMs = 60_000): Promise<Response> {
    try {
      return await this.f(`${this.opts.url.replace(/\/+$/, '')}/browser/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.secret}` },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        redirect: 'error'
      })
    } catch {
      throw new BrowserError('The browser service could not be reached. Try again in a moment.', 'failed')
    }
  }

  private async json<T>(res: Response): Promise<T> {
    const text = await res.text().catch(() => '')
    let body: any = null
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    if (!res.ok) {
      // The worker's own messages are written for people; anything else is not shown.
      const known = ['bad_input', 'unsafe', 'not_found', 'limit', 'failed']
      if (typeof body?.error === 'string' && known.includes(body.code)) throw new BrowserError(body.error.slice(0, 300), body.code)
      throw new BrowserError('The browser service could not do that.', 'failed')
    }
    return body as T
  }

  async check(key: string, action: BrowserAction) {
    const r = await this.json<{ ask: boolean, label: string }>(await this.call('check', { key, action }, undefined, 15_000))
    return { ask: Boolean(r.ask), label: String(r.label ?? '').slice(0, 300) }
  }
  async act(key: string, action: BrowserAction, opts: { approved?: boolean, signal?: AbortSignal } = {}) {
    return await this.json<ActResult>(await this.call('act', { key, action, approved: Boolean(opts.approved) }, opts.signal, 75_000))
  }
  async status(key: string) {
    const r = await this.json<{ session: SessionStatus | null }>(await this.call('status', { key }, undefined, 15_000))
    return r.session
  }
  async frame(key: string): Promise<Frame | null> {
    const res = await this.call('frame', { key }, undefined, 15_000)
    if (res.status === 404) return null
    if (!res.ok) throw new BrowserError('The browser service could not do that.', 'failed')
    return frameFromHeaders(Buffer.from(await res.arrayBuffer()), res.headers)
  }
  async takeOver(key: string) { await this.json(await this.call('takeover', { key }, undefined, 15_000)) }
  async handBack(key: string) { return (await this.json<{ state: PageState }>(await this.call('handback', { key }, undefined, 30_000))).state }
  async input(key: string, input: UserInput) { await this.json(await this.call('input', { key, input }, undefined, 15_000)) }
  async hold(key: string, ms: number) { await this.json(await this.call('hold', { key, ms }, undefined, 15_000)) }
  async close(key: string) { await this.json(await this.call('close', { key }, undefined, 15_000)) }
}

// ---- What the worker answers --------------------------------------------------------------------------------------

export interface WorkerReply { status: number, json?: unknown, image?: Frame }

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
export const bearerMatches = (header: string | undefined, secret: string) => same((header ?? '').replace(/^Bearer\s+/i, ''), secret)

const STATUS: Record<string, number> = { bad_input: 400, unsafe: 400, not_found: 404, limit: 429, failed: 502 }

/** Turns one request to the worker into a reply. Pure apart from the service it is given, so it is tested without a server. */
export async function answerWorker(service: BrowserService, path: string, body: any): Promise<WorkerReply> {
  const key = body?.key
  if (!validKey(key)) return { status: 400, json: { error: 'That is not a valid session key.', code: 'bad_input' } }
  try {
    switch (path) {
      case 'check': return { status: 200, json: await service.check(key, body.action) }
      case 'act': return { status: 200, json: await service.act(key, body.action, { approved: body.approved === true }) }
      case 'status': return { status: 200, json: { session: await service.status(key) } }
      case 'frame': {
        const frame = await service.frame(key)
        return frame ? { status: 200, image: frame } : { status: 404, json: { error: 'No page is open.', code: 'not_found' } }
      }
      case 'takeover': await service.takeOver(key); return { status: 200, json: { ok: true } }
      case 'handback': return { status: 200, json: { state: await service.handBack(key) } }
      case 'input': await service.input(key, body.input); return { status: 200, json: { ok: true } }
      case 'hold': await service.hold(key, Math.min(Math.max(Number(body.ms) || 0, 0), BROWSER_LIMITS.holdMs)); return { status: 200, json: { ok: true } }
      case 'close': await service.close(key); return { status: 200, json: { ok: true } }
      default: return { status: 404, json: { error: 'Not found', code: 'not_found' } }
    }
  } catch (err: any) {
    if (err instanceof BrowserError) return { status: STATUS[err.code] ?? 400, json: { error: err.message, code: err.code } }
    console.error('[browser] failed:', err?.message)
    return { status: 500, json: { error: 'The browser could not do that.', code: 'failed' } }
  }
}

// ---- Which one is in use ------------------------------------------------------------------------------------------

let local: LocalBrowserService | null = null

/** The configured browser service, or null when browser use is not set up here. */
export function defaultBrowserService(env: NodeJS.ProcessEnv = process.env): BrowserService | null {
  if (env.INSPECTOR_URL && env.INSPECTOR_SECRET) return new RemoteBrowserService({ url: env.INSPECTOR_URL, secret: env.INSPECTOR_SECRET })
  if (env.INSPECTOR_LOCAL === '1' && env.NODE_ENV !== 'production') {
    local ??= new LocalBrowserService({ allowLocal: env.INSPECT_ALLOW_LOCAL === '1' })
    return local
  }
  return null
}
