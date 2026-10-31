/**
 * Live browser steps between OpenLobs and a computer's Bridge. Unlike a job (a stored request with a result), a live
 * step is one call to a browser that is open right now: look at the page, click, type. They are frequent and
 * short-lived, so they are handed over in memory and never stored.
 */

/** The only things OpenLobs can ask the browser on a computer to do. */
export const LIVE_OPS = ['check', 'act', 'status', 'frame', 'takeover', 'handback', 'input', 'hold', 'close'] as const
export type LiveOp = typeof LIVE_OPS[number]
export const isLiveOp = (v: unknown): v is LiveOp => (LIVE_OPS as readonly string[]).includes(String(v))

/** The permission a person gives on the computer, and the capability the computer then reports. */
export const BROWSER_USE_PERMISSION = 'browser_use'
export const BROWSER_USE_CAPABILITY = 'browser_session'

/** What the server hands a computer. */
export interface LiveRequest { id: string, op: LiveOp, key: string, payload: Record<string, unknown> }

export type LiveReply =
  | { ok: true, result?: unknown, frame?: LiveFrame | null }
  | { ok: false, error: string, code?: string, cancelled?: boolean }

export interface LiveFrame {
  imageBase64: string
  width: number
  height: number
  url: string
  title: string
  control: 'assistant' | 'person'
  tabs: { title: string, host: string, active: boolean }[]
}

export const LIVE_LIMITS = {
  /** How long OpenLobs waits for the computer to answer one step, by kind of step. */
  timeoutMs: { check: 15_000, act: 80_000, status: 15_000, frame: 15_000, takeover: 15_000, handback: 30_000, input: 15_000, hold: 15_000, close: 15_000 } as Record<LiveOp, number>,
  maxPending: 20,
  maxFrameBase64: 1_100_000
}
