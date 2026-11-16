import { boxRequestSchema, boxResponseSchema } from '../../../shared/cloudBox'
import type { BoxResponse } from '../../../shared/cloudBox'
import { CLOUD_LIMITS } from '../../../shared/cloudBox'
import { InspectError } from '../inspect/browser'

/**
 * Where the cloud box comes from. A provider takes one plan (steps and small files) and answers with what each
 * step printed. The box is empty when it starts and is thrown away afterwards.
 * Today there is one provider, the OpenLobs box worker (runner/), which runs on Cloud Run or any Docker host.
 * Another provider (a hosted sandbox service) plugs in here without changing anything else.
 */
export interface CloudBox {
  name: string
  run(req: unknown, signal?: AbortSignal): Promise<BoxResponse>
}

export interface RunnerOptions { url: string, secret: string, fetch?: typeof fetch }

const MAX_REPLY_CHARS = 120_000

/** Calls the box worker. The plan is checked again here, and the answer is checked before anyone sees it. */
export function runnerBox(opts: RunnerOptions): CloudBox {
  const f = opts.fetch ?? fetch
  return {
    name: 'the OpenLobs cloud box',
    async run(raw, signal) {
      const req = boxRequestSchema.safeParse(raw)
      if (!req.success) throw new InspectError(req.error.issues[0]?.message || 'That plan could not be sent to the cloud box.')
      let res: Response
      try {
        res = await f(`${opts.url.replace(/\/+$/, '')}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.secret}` },
          body: JSON.stringify(req.data),
          // Starting a fresh box can take a few seconds, then the plan itself runs.
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(CLOUD_LIMITS.planMs + 45_000)]),
          redirect: 'error'
        })
      } catch {
        throw new InspectError('The cloud box could not be reached. Nothing was run. Try again in a moment.')
      }
      if (res.status === 429) throw new InspectError('The cloud box is busy with another plan. Nothing was run. Try again in a moment.')
      const text = await res.text().catch(() => '')
      if (!res.ok || text.length > MAX_REPLY_CHARS) throw new InspectError('The cloud box could not run the plan. Nothing was run.')
      let body: unknown
      try { body = JSON.parse(text) } catch { throw new InspectError('The cloud box sent something unreadable.') }
      const reply = boxResponseSchema.safeParse(body)
      if (!reply.success) throw new InspectError('The cloud box sent something unreadable.')
      return reply.data
    }
  }
}

/** The configured box, or null when this app has none (the tool is then not offered). Both values come from the environment, never from chat. */
export function defaultCloudBox(env: NodeJS.ProcessEnv = process.env): CloudBox | null {
  if (!env.RUNNER_URL || !env.RUNNER_SECRET) return null
  let url: URL
  try { url = new URL(env.RUNNER_URL) } catch { return null }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  // A secret never travels over plain http, except to this same machine while developing.
  if (url.protocol !== 'https:' && !(local && env.NODE_ENV !== 'production' && url.protocol === 'http:')) return null
  return runnerBox({ url: url.toString(), secret: env.RUNNER_SECRET })
}
