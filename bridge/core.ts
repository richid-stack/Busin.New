import os from 'node:os'

/**
 * The OpenLobs Bridge, without the command line around it, so it can be tested.
 *
 * Three promises, which the tests check:
 *  1. It only ever calls OpenLobs. It opens no port and accepts no connection.
 *  2. It runs only the jobs in HANDLERS below. Anything else is refused here, whatever the server says.
 *  3. A job can be stopped, and the Bridge says out loud what it is doing.
 */

export const BRIDGE_VERSION = '0.1.0'

export interface Config { server: string, deviceId: string, token: string, name: string }

export interface Deps {
  fetch: typeof fetch
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  now: () => Date
  log: (line: string) => void
  platform: () => 'windows' | 'mac' | 'linux' | 'other'
  osRelease: () => string
}

export const defaultDeps = (log: (line: string) => void = line => console.log(line)): Deps => ({
  fetch: (...a) => fetch(...a),
  sleep: (ms, signal) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  }),
  now: () => new Date(),
  log,
  platform: () => (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : 'other'),
  osRelease: () => `${os.type()} ${os.release()}`
})

export type Handler = (input: Record<string, unknown>, ctx: { deps: Deps, signal: AbortSignal }) => Promise<Record<string, unknown>>

/** Everything this Bridge is willing to do. To teach it something new, add it here, on purpose. */
export const HANDLERS: Record<string, { label: string, run: Handler }> = {
  ping: {
    label: 'Answer a test ping',
    run: async (_input, { deps }) => ({
      bridgeVersion: BRIDGE_VERSION,
      platform: deps.platform(),
      osVersion: deps.osRelease().slice(0, 120),
      time: deps.now().toISOString(),
      capabilities: Object.keys(HANDLERS)
    })
  }
}

/** The server address must be https, except for a server on this machine while developing. */
export function checkServer(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('That is not a web address. Use the address of your OpenLobs, like https://openlobs.example.') }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('The server address must start with https://.')
  if (url.username || url.password) throw new Error('The server address must not contain a user name or password.')
  return url.origin
}

class AuthError extends Error {}

async function call(config: Pick<Config, 'server' | 'token'>, deps: Deps, path: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await deps.fetch(`${config.server}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body ?? {}),
    redirect: 'error',
    signal
  })
  if (res.status === 401) throw new AuthError('OpenLobs no longer recognises this computer.')
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) throw new Error(String(json?.statusMessage || json?.message || `OpenLobs answered ${res.status}.`).slice(0, 200))
  return json
}

/** Trades the code from the OpenLobs page for this computer's token. */
export async function pair(serverRaw: string, code: string, name: string, deps: Deps): Promise<Config> {
  const server = checkServer(serverRaw)
  const res = await deps.fetch(`${server}/api/bridge/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, platform: deps.platform(), version: BRIDGE_VERSION }),
    redirect: 'error'
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok || typeof json?.token !== 'string' || typeof json?.deviceId !== 'string') {
    throw new Error(String(json?.statusMessage || 'Pairing failed. Check the code and try again.').slice(0, 200))
  }
  return { server, deviceId: json.deviceId, token: json.token, name }
}

export interface Running { controller: AbortController, kind: string }

/**
 * One round: ask for work, start it, report what happened. Returns false when OpenLobs says this computer was
 * disconnected, so the caller stops for good.
 */
export async function pollOnce(config: Config, deps: Deps, running: Map<string, Running>, signal?: AbortSignal): Promise<boolean> {
  const answer = await call(config, deps, '/api/bridge/poll', { version: BRIDGE_VERSION, capabilities: Object.keys(HANDLERS) }, signal)
  if (answer?.revoked) return false

  for (const id of Array.isArray(answer?.cancel) ? answer.cancel : []) {
    const r = running.get(String(id))
    if (r) { deps.log(`Stopping "${r.kind}" because you cancelled it.`); r.controller.abort() }
    else await call(config, deps, `/api/bridge/jobs/${encodeURIComponent(String(id))}/result`, { ok: false, cancelled: true }).catch(() => {})
  }

  const started: Promise<void>[] = []
  for (const job of Array.isArray(answer?.jobs) ? answer.jobs : []) {
    const id = String(job?.id ?? '')
    const kind = String(job?.kind ?? '')
    if (!id) continue
    const report = (body: Record<string, unknown>) => call(config, deps, `/api/bridge/jobs/${encodeURIComponent(id)}/result`, body).catch(err => deps.log(`Could not report on "${kind}": ${err.message}`))
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, kind) ? HANDLERS[kind] : undefined
    if (!handler) {
      // The server asked for something this Bridge does not do. Refuse, and say so.
      deps.log(`Refused "${kind.slice(0, 40)}": this Bridge does not do that.`)
      started.push(report({ ok: false, error: 'This Bridge does not do that.' }))
      continue
    }
    const controller = new AbortController()
    running.set(id, { controller, kind })
    deps.log(`Running "${kind}" (${handler.label})...`)
    started.push((async () => {
      try {
        const result = await handler.run(typeof job.input === 'object' && job.input ? job.input : {}, { deps, signal: controller.signal })
        if (controller.signal.aborted) { await report({ ok: false, cancelled: true }); deps.log(`Stopped "${kind}".`) }
        else { await report({ ok: true, result }); deps.log(`Finished "${kind}".`) }
      } catch (err: any) {
        if (controller.signal.aborted) await report({ ok: false, cancelled: true })
        else { deps.log(`"${kind}" failed: ${String(err?.message ?? err).slice(0, 200)}`); await report({ ok: false, error: String(err?.message ?? 'The job failed.').slice(0, 300) }) }
      } finally {
        running.delete(id)
      }
    })())
  }
  await Promise.all(started)
  return true
}

/** Keeps asking until stopped or disconnected. Network trouble backs off (1 s, doubling, up to 60 s) instead of hammering. */
export async function run(config: Config, deps: Deps, signal: AbortSignal): Promise<'stopped' | 'disconnected'> {
  const running = new Map<string, Running>()
  let wait = 1000
  deps.log(`Connected as "${config.name}". Waiting for OpenLobs. Press Ctrl+C to stop.`)
  while (!signal.aborted) {
    try {
      if (!(await pollOnce(config, deps, running, signal))) { deps.log('This computer was disconnected from OpenLobs.'); return 'disconnected' }
      wait = 1000
    } catch (err: any) {
      if (signal.aborted) break
      if (err instanceof AuthError) { deps.log(err.message); return 'disconnected' }
      deps.log(`Cannot reach OpenLobs (${String(err?.message ?? err).slice(0, 100)}). Trying again in ${Math.round(wait / 1000)} s.`)
      await deps.sleep(wait, signal)
      wait = Math.min(wait * 2, 60_000)
    }
  }
  // Stopping the Bridge stops whatever it was doing.
  for (const r of running.values()) r.controller.abort()
  return 'stopped'
}

/** Tells OpenLobs to forget this computer. Local files are removed by the caller. */
export async function disconnect(config: Config, deps: Deps): Promise<void> {
  await call(config, deps, '/api/bridge/disconnect', {})
}
