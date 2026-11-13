import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { runBoxPlan } from './plan'
import type { BoxDeps } from './plan'

/**
 * The cloud box worker's web face: one endpoint, `POST /run`, behind a shared secret.
 * It takes one plan at a time and, by default, asks to be restarted after it answers, so every plan meets a
 * fresh instance (a program cannot leave anything behind for the next person).
 */
export interface RunnerOptions {
  secret: string
  box?: BoxDeps
  /** Called after a plan has been answered. The real worker exits so the platform starts a clean instance. */
  afterPlan?: () => void
  maxBodyChars?: number
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > max) return null
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createRunnerServer(opts: RunnerOptions): Server {
  if (opts.secret.length < 24) throw new Error('RUNNER_SECRET must be at least 24 characters.')
  let busy = false
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true })
      if (req.method !== 'POST' || req.url !== '/run') return send(res, 404, { error: 'Not found' })
      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!same(bearer, opts.secret)) return send(res, 401, { error: 'Unauthorized' })
      if (busy) return send(res, 429, { error: 'Busy, try again in a moment.' })
      busy = true
      let spent = false
      const abort = new AbortController()
      // If the app gives up and hangs up, stop the programs too.
      res.on('close', () => { if (!res.writableEnded) abort.abort() })
      try {
        const text = await readBody(req, opts.maxBodyChars ?? 200_000)
        if (text === null) return send(res, 413, { error: 'The plan is too large.' })
        let body: unknown
        try { body = JSON.parse(text) } catch { return send(res, 400, { error: 'That request could not be read.' }) }
        spent = true // from here on the box has been used
        const result = await runBoxPlan(body, abort.signal, opts.box)
        send(res, 200, result)
      } finally {
        // The box is used once. After a plan, ask for a clean instance before the next one. A request that never reached a plan
        // (too large, unreadable) leaves the box clean, so it neither restarts the worker nor blocks it.
        if (spent) {
          let asked = false
          const clean = () => { if (!asked) { asked = true; opts.afterPlan?.() } }
          if (res.writableFinished) clean(); else res.once('finish', clean)
        }
        // With a restart on the way this instance never takes another plan, so a second request cannot start in a process that is about to exit.
        if (!(spent && opts.afterPlan)) busy = false
      }
    } catch (err: any) {
      console.error('[runner] failed:', err?.message)
      if (!res.headersSent) send(res, 500, { error: 'The plan could not be run.' })
    }
  })
}
