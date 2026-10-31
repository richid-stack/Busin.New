import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { LIVE_LIMITS, isLiveOp } from '../../../shared/bridgeLive'
import type { LiveFrame, LiveOp, LiveReply, LiveRequest } from '../../../shared/bridgeLive'

/**
 * Hands live browser steps to a connected computer and carries its answers back, in memory. The computer asks
 * "anything for me?" the way it always does (the poll), and a waiting poll is woken the moment a step is queued.
 *
 * This lives in one server process, like the poll wake-up it rides on. OpenLobs runs one instance; if it ever runs
 * more, a step queued on one is not seen by a poll waiting on another, and the step times out with a clear message.
 */

interface Pending {
  req: LiveRequest
  deviceId: string
  /** Handed to the computer already. */
  sent: boolean
  /** The caller gave up while the computer had it: the computer is told to stop. */
  stopNotified: boolean
  cancelled: boolean
  finish: (reply: LiveReply) => void
}

export interface LiveBroker {
  /** Queues a step for a computer and waits for its answer. Rejects with an Error whose message is fit to show. */
  request(deviceId: string, op: LiveOp, key: string, payload: Record<string, unknown>, opts?: { signal?: AbortSignal, timeoutMs?: number }): Promise<LiveReply>
  /** Steps waiting for this computer, handed over once. */
  take(deviceId: string): LiveRequest[]
  /** Ids of steps the computer is running that the person no longer wants. Handed over once. */
  takeStops(deviceId: string): string[]
  /** Is anything waiting for this computer? */
  has(deviceId: string): boolean
  /** The computer's answer. False when the step is unknown, already answered, or belongs to another computer. */
  reply(deviceId: string, id: string, reply: LiveReply): boolean
  /** Fails every step for a computer (it was disconnected). */
  dropDevice(deviceId: string, message: string): void
}

export function createLiveBroker(wake: (deviceId: string) => void): LiveBroker {
  const pending = new Map<string, Pending>()
  const forDevice = (deviceId: string) => [...pending.values()].filter(p => p.deviceId === deviceId)

  return {
    request(deviceId, op, key, payload, opts = {}) {
      if (forDevice(deviceId).length >= LIVE_LIMITS.maxPending) return Promise.reject(new Error('This computer has too many browser steps waiting. Try again in a moment.'))
      const id = randomUUID()
      return new Promise<LiveReply>((resolve, reject) => {
        let done = false
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('Your computer did not answer in time. Check that the Bridge is running there and not paused.'))
        }, opts.timeoutMs ?? LIVE_LIMITS.timeoutMs[op])
        const onAbort = () => {
          const p = pending.get(id)
          if (!p || done) return
          p.cancelled = true
          done = true
          clearTimeout(timer)
          reject(new Error('Cancelled.'))
          // A step the computer never took is simply dropped; one it is running stays listed until it has been told to stop.
          if (!p.sent) pending.delete(id)
          else wake(deviceId)
        }
        const cleanup = () => {
          done = true
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          pending.delete(id)
        }
        const p: Pending = {
          req: { id, op, key, payload }, deviceId, sent: false, stopNotified: false, cancelled: false,
          finish: (reply) => { if (done) return; cleanup(); resolve(reply) }
        }
        pending.set(id, p)
        if (opts.signal?.aborted) return onAbort()
        opts.signal?.addEventListener('abort', onAbort, { once: true })
        wake(deviceId)
      })
    },

    take(deviceId) {
      const out: LiveRequest[] = []
      for (const p of forDevice(deviceId)) if (!p.sent && !p.cancelled) { p.sent = true; out.push(p.req) }
      return out
    },

    takeStops(deviceId) {
      const out: string[] = []
      for (const p of forDevice(deviceId)) if (p.sent && p.cancelled && !p.stopNotified) { p.stopNotified = true; out.push(p.req.id); pending.delete(p.req.id) }
      return out
    },

    has(deviceId) {
      return forDevice(deviceId).some(p => (!p.sent && !p.cancelled) || (p.sent && p.cancelled && !p.stopNotified))
    },

    reply(deviceId, id, reply) {
      const p = pending.get(id)
      if (!p || p.deviceId !== deviceId || !p.sent) return false
      if (p.cancelled) { pending.delete(id); return true }
      p.finish(reply)
      return true
    },

    dropDevice(deviceId, message) {
      for (const p of forDevice(deviceId)) p.finish({ ok: false, error: message })
    }
  }
}

// ---- What a computer may answer with. It came from another machine, so it is checked like any outside input. ----

const text = (n: number) => z.string().max(n)
const tab = z.object({ title: text(60), host: text(80), active: z.boolean() })

export const liveFrameSchema = z.object({
  imageBase64: z.string().min(8).max(LIVE_LIMITS.maxFrameBase64),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
  url: text(2000),
  title: text(200),
  control: z.enum(['assistant', 'person']),
  tabs: z.array(tab).max(8)
}).strict()

export const liveReplySchema: z.ZodType<LiveReply> = z.union([
  z.object({ ok: z.literal(true), result: z.unknown().optional(), frame: liveFrameSchema.nullable().optional() }).strict(),
  z.object({ ok: z.literal(false), error: text(300), code: text(20).optional(), cancelled: z.boolean().optional() }).strict()
]) as z.ZodType<LiveReply>

/** Only a real JPEG is accepted as a picture, judged by its first bytes, not by what the computer calls it. */
export function frameBytes(frame: LiveFrame): Buffer | null {
  const bytes = Buffer.from(frame.imageBase64, 'base64')
  return bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF ? bytes : null
}

export { isLiveOp }

let shared: LiveBroker | null = null
/** The one broker of this process. `wake` is the poll wake-up of the Bridge store. */
export function liveBroker(wake: (deviceId: string) => void): LiveBroker {
  shared ??= createLiveBroker(wake)
  return shared
}
