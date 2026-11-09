import { LIVE_LIMITS } from '../shared/bridgeLive'
import type { LiveReply } from '../shared/bridgeLive'
import { BROWSER_LIMITS, BrowserError, actionSchema } from '../server/services/browser/model'
import { validKey } from '../server/services/browser/service'
import type { LiveBrowserHost } from './core'
import type { DeviceBrowser } from './deviceBrowser'

/**
 * Runs the live browser steps OpenLobs asks for on this computer's browser. Nothing here decides what is safe: the
 * browser engine does (it asks the person before anything that sends, pays or deletes, refuses to type passwords,
 * and stops loops). This only turns a request into a call and the outcome into an answer, and never throws.
 */
export function createLiveHost(browser: DeviceBrowser): LiveBrowserHost {
  const svc = browser.service
  return {
    async run(req, signal): Promise<LiveReply> {
      try {
        if (!validKey(req.key)) return { ok: false, error: 'That is not a valid session.', code: 'bad_input' }
        const p = req.payload
        switch (req.op) {
          case 'check': {
            const action = actionSchema.safeParse(p.action)
            if (!action.success) return { ok: false, error: 'That is not an action the browser can do.', code: 'bad_input' }
            return { ok: true, result: await svc.check(req.key, action.data) }
          }
          case 'act': {
            const action = actionSchema.safeParse(p.action)
            if (!action.success) return { ok: false, error: 'That is not an action the browser can do.', code: 'bad_input' }
            return { ok: true, result: await svc.act(req.key, action.data, { approved: p.approved === true, signal }) }
          }
          case 'status': return { ok: true, result: await svc.status(req.key) }
          case 'frame': {
            const f = await svc.frame(req.key)
            if (!f) return { ok: true, frame: null }
            const imageBase64 = f.bytes.toString('base64')
            if (imageBase64.length > LIVE_LIMITS.maxFrameBase64) return { ok: false, error: 'The page picture was too large to send.', code: 'failed' }
            return { ok: true, frame: { imageBase64, width: f.width, height: f.height, url: f.url, title: f.title, control: f.control, tabs: f.tabs } }
          }
          case 'takeover': await svc.takeOver(req.key); return { ok: true }
          case 'handback': return { ok: true, result: { state: await svc.handBack(req.key) } }
          case 'input': await svc.input(req.key, p.input as never); return { ok: true }
          case 'hold': await svc.hold(req.key, Math.min(Math.max(Number(p.ms) || 0, 0), BROWSER_LIMITS.holdMs)); return { ok: true }
          case 'close': await svc.close(req.key); return { ok: true }
        }
      } catch (err: any) {
        if (err instanceof BrowserError) return { ok: false, error: err.message.slice(0, 300), code: err.code }
        return { ok: false, error: 'The browser on this computer could not do that.', code: 'failed' }
      } finally {
        browser.noteSessionMaybeEnded()
      }
    },
    stop: () => browser.closeBrowser()
  }
}
