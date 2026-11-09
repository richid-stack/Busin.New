import { z } from 'zod'
import { BROWSER_USE_CAPABILITY, type LiveOp, type LiveReply } from '../../../shared/bridgeLive'
import { BrowserError, type BrowserAction, type PageState, type UserInput } from '../browser/model'
import type { ActResult, Frame } from '../browser/session'
import type { BrowserService, SessionStatus } from '../browser/service'
import { isOnline } from './model'
import type { Device } from './model'
import { frameBytes, liveFrameSchema } from './live'
import type { LiveBroker } from './live'

/**
 * The browser service that runs on the person's own computer, through the Bridge. It looks exactly like the hosted
 * one to the rest of the app: the same steps, the same approvals, the same live picture. Only where the browser is
 * differs, and with it which sign-ins it has (the ones the person made in that browser profile).
 */

export interface BridgeBrowserOptions {
  store: { listDevices(userId: string): Promise<Device[]> }
  broker: LiveBroker
  userId: string
  now?: () => Date
}

const text = (n: number) => z.string().max(n)
const element = z.object({
  ref: z.number().int(), role: text(40), name: text(300), type: text(40).optional(), value: text(300).optional(),
  checked: z.boolean().optional(), disabled: z.boolean().optional(), required: z.boolean().optional(),
  options: z.array(text(200)).max(60).optional(), href: text(500).optional(), inView: z.boolean(),
  inSearch: z.boolean().optional(), inForm: z.boolean().optional(), sensitive: z.boolean().optional()
}).strip()

export const pageStateSchema = z.object({
  url: text(2000), title: text(300), elements: z.array(element).max(200), text: text(8000),
  scroll: z.object({ y: z.number(), max: z.number() }),
  focus: z.object({ ref: z.number().int().nullable(), inSearch: z.boolean(), inForm: z.boolean() }),
  hasPassword: z.boolean(), blocker: z.enum(['captcha', 'login']).nullable(),
  dialogs: z.array(text(300)).max(10), tabs: z.number().int().min(0).max(20), truncated: z.boolean()
}).strip()

const checkResult = z.object({ ask: z.boolean(), label: text(300) }).strip()
const actResult = z.object({ state: pageStateSchema, navigated: z.boolean() }).strip()
const statusResult = z.object({
  url: text(2000), title: text(300), control: z.enum(['assistant', 'person']), actions: z.number().int(),
  idleLeftMs: z.number(), holdLeftMs: z.number(), viewedAgoMs: z.number().nullable()
}).strip().nullable()
const stateResult = z.object({ state: pageStateSchema }).strip()

const KNOWN = ['bad_input', 'unsafe', 'not_found', 'limit', 'failed'] as const

export class BridgeBrowserService implements BrowserService {
  private readonly now: () => Date
  constructor(private readonly opts: BridgeBrowserOptions) { this.now = opts.now ?? (() => new Date()) }

  private async device(): Promise<Device> {
    const devices = await this.opts.store.listDevices(this.opts.userId)
    if (!devices.length) throw new BrowserError('No computer is connected to OpenLobs. Add one on the Computers page first.', 'failed')
    const online = devices.filter(d => isOnline(d, this.now()))
    if (!online.length) throw new BrowserError(`${devices.length === 1 ? `"${devices[0]!.name}" is` : 'Your computers are'} offline. Start the Bridge on it, or switch the browser back to the cloud in Settings.`, 'failed')
    const allowed = online.filter(d => d.capabilities.includes(BROWSER_USE_CAPABILITY))
    if (!allowed.length) throw new BrowserError(`"${online[0]!.name}" has not been allowed to let OpenLobs use a browser. On that computer, run: bridge allow browser_use`, 'failed')
    return [...allowed].sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))[0]!
  }

  private async call(op: LiveOp, key: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<LiveReply & { ok: true }> {
    const device = await this.device()
    let reply: LiveReply
    try {
      reply = await this.opts.broker.request(device.id, op, key, payload, { signal })
    } catch (err: any) {
      throw new BrowserError(String(err?.message || 'The computer could not be reached.').slice(0, 300), 'failed')
    }
    if (!reply.ok) {
      const code = (KNOWN as readonly string[]).includes(String(reply.code)) ? reply.code as typeof KNOWN[number] : 'failed'
      throw new BrowserError(String(reply.error || 'The browser on your computer could not do that.').slice(0, 300), code)
    }
    return reply
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new BrowserError('Your computer sent back something OpenLobs could not read.', 'failed')
    return parsed.data
  }

  async check(key: string, action: BrowserAction) {
    return this.parse(checkResult, (await this.call('check', key, { action })).result)
  }
  async act(key: string, action: BrowserAction, opts: { approved?: boolean, signal?: AbortSignal } = {}): Promise<ActResult> {
    return this.parse(actResult, (await this.call('act', key, { action, approved: Boolean(opts.approved) }, opts.signal)).result) as ActResult
  }
  async status(key: string): Promise<SessionStatus | null> {
    return this.parse(statusResult, (await this.call('status', key)).result) as SessionStatus | null
  }
  async frame(key: string): Promise<Frame | null> {
    const reply = await this.call('frame', key)
    if (!reply.frame) return null
    const f = this.parse(liveFrameSchema, reply.frame)
    const bytes = frameBytes(f)
    if (!bytes) throw new BrowserError('Your computer sent back a picture OpenLobs could not read.', 'failed')
    // The address bar only ever shows a web page, whatever the computer says.
    const url = /^https?:\/\//i.test(f.url) || f.url === 'about:blank' ? f.url : 'about:blank'
    return { bytes, width: f.width, height: f.height, url, title: f.title, control: f.control, tabs: f.tabs }
  }
  async takeOver(key: string) { await this.call('takeover', key) }
  async handBack(key: string): Promise<PageState> { return this.parse(stateResult, (await this.call('handback', key)).result).state as PageState }
  async input(key: string, input: UserInput) { await this.call('input', key, { input }) }
  async hold(key: string, ms: number) { await this.call('hold', key, { ms }) }
  async close(key: string) { await this.call('close', key) }
}
