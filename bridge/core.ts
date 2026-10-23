import os from 'node:os'
import { look, parseLookInput } from './browser'
import type { LookDeps } from './browser'
import { workbookApply, workbookInspect, workbookList } from './sheets/jobs'
import type { SheetDeps } from './sheets/jobs'
import type { Control } from './control'

/**
 * The OpenLobs Bridge, without the command line around it, so it can be tested.
 *
 * Three promises, which the tests check:
 *  1. It only ever calls OpenLobs. It opens no port and accepts no connection.
 *  2. It runs only the jobs in HANDLERS below. Anything else is refused here, whatever the server says.
 *  3. A job can be stopped, and the Bridge says out loud what it is doing.
 */

export const BRIDGE_VERSION = '0.4.0'

/** `allow` lists what the person has allowed on this computer (see PERMISSIONS). A ping is always allowed. */
export interface Config { server: string, deviceId: string, token: string, name: string, allow?: string[], /** The one folder spreadsheet jobs may use. Chosen on this computer. */ workspace?: string }

export interface Deps {
  fetch: typeof fetch
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  now: () => Date
  log: (line: string) => void
  platform: () => 'windows' | 'mac' | 'linux' | 'other'
  osRelease: () => string
  /** Replaceable in tests: the browser and the address lookup used by browser jobs. */
  browser?: LookDeps
  /** Replaceable in tests: which spreadsheet program is used. */
  sheets?: SheetDeps
  /** The pause switch and status board shared with the tray icon. Absent in tests that do not need it. */
  control?: Control
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

export interface HandlerContext {
  deps: Deps
  signal: AbortSignal
  /** The jobs this computer is willing to do right now. */
  active: string[]
  /** Sends a picture for this job to OpenLobs. */
  upload: (bytes: Uint8Array, mediaType: 'image/jpeg' | 'image/png') => Promise<void>
  /** The folder the person chose for spreadsheets, if any. */
  workspace: string | null
}
export type Handler = (input: Record<string, unknown>, ctx: HandlerContext) => Promise<Record<string, unknown>>

/** What the person can switch on for this computer. Each one unlocks specific jobs and nothing else. */
export const PERMISSIONS: Record<string, { label: string, kinds: string[] }> = {
  browser: { label: 'Look at web pages in Edge or Chrome (read-only, in an empty browser with no logins)', kinds: ['browser_look'] },
  excel: { label: 'Read spreadsheets in one folder and save changed copies there (the original is never changed)', kinds: ['workbook_list', 'workbook_inspect', 'workbook_apply'] }
}
export const ALWAYS_ALLOWED = ['ping']

/** The jobs this computer will do right now: a ping, plus whatever the person allowed. */
export function activeKinds(config: Pick<Config, 'allow' | 'workspace'>): string[] {
  const kinds = [...ALWAYS_ALLOWED]
  for (const name of config.allow ?? []) {
    if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, name)) continue
    // Spreadsheet work needs a folder. Without one, nothing is offered.
    if (name === 'excel' && !config.workspace) continue
    kinds.push(...PERMISSIONS[name]!.kinds)
  }
  return kinds
}

/** Everything this Bridge is willing to do. To teach it something new, add it here, on purpose. */
export const HANDLERS: Record<string, { label: string, run: Handler }> = {
  ping: {
    label: 'Answer a test ping',
    run: async (_input, { deps, active }) => ({
      bridgeVersion: BRIDGE_VERSION,
      platform: deps.platform(),
      osVersion: deps.osRelease().slice(0, 120),
      time: deps.now().toISOString(),
      capabilities: active
    })
  },
  browser_look: {
    label: 'Look at a web page and take a picture',
    run: async (input, { deps, signal, upload }) => {
      let parsed
      try { parsed = parseLookInput(input) } catch (err: any) { throw new Error(err.message) }
      const out = await look(parsed, signal, deps.browser)
      await upload(out.image, out.mediaType)
      return { ...out.facts }
    }
  },
  workbook_list: {
    label: 'List spreadsheets in the chosen folder',
    run: async (input, { workspace }) => ({ ...(await workbookList(workspace, input)) })
  },
  workbook_inspect: {
    label: 'Read a spreadsheet in the chosen folder',
    run: async (input, { workspace }) => ({ ...(await workbookInspect(workspace, input)) })
  },
  workbook_apply: {
    label: 'Save a changed copy of a spreadsheet in the chosen folder',
    run: async (input, { workspace, signal, deps }) => ({ ...(await workbookApply(workspace, input, signal, deps.sheets)) })
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
  // A pause beats everything: while paused this computer says it can do nothing, and refuses whatever still arrives.
  const paused = deps.control?.paused() ?? false
  const active = paused ? [] : activeKinds(config)
  if (paused) for (const r of running.values()) r.controller.abort()
  const answer = await call(config, deps, '/api/bridge/poll', { version: BRIDGE_VERSION, capabilities: active }, signal)
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
    const known = Object.prototype.hasOwnProperty.call(HANDLERS, kind)
    const handler = known ? HANDLERS[kind] : undefined
    if (!handler) {
      // The server asked for something this Bridge does not do. Refuse, and say so.
      deps.log(`Refused "${kind.slice(0, 40)}": this Bridge does not do that.`)
      started.push(report({ ok: false, error: 'This Bridge does not do that.' }))
      continue
    }
    if (paused || deps.control?.paused()) {
      deps.log(`Refused "${kind}": this computer is paused.`)
      started.push(report({ ok: false, error: 'This computer is paused. Resume it from the tray icon.' }))
      continue
    }
    if (!active.includes(kind)) {
      // The Bridge can do it, but the person has not allowed it on this computer. Their word beats the server's.
      deps.log(`Refused "${kind}": you have not allowed this on this computer.`)
      started.push(report({ ok: false, error: 'This computer has not been allowed to do that.' }))
      continue
    }
    const controller = new AbortController()
    running.set(id, { controller, kind })
    deps.log(`Running "${kind}" (${handler.label})...`)
    started.push((async () => {
      try {
        const upload = async (bytes: Uint8Array, mediaType: 'image/jpeg' | 'image/png') => {
          await call(config, deps, `/api/bridge/jobs/${encodeURIComponent(id)}/file`, { mediaType, imageBase64: Buffer.from(bytes).toString('base64') }, controller.signal)
        }
        const result = await handler.run(typeof job.input === 'object' && job.input ? job.input : {}, { deps, signal: controller.signal, active, upload, workspace: config.workspace ?? null })
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

/**
 * Keeps asking until stopped or disconnected. Network trouble backs off (1 s, doubling, up to 60 s) instead of
 * hammering. Twice a second it also looks at the pause and quit switches (the tray icon sets them): a pause
 * stops whatever is running at once (and the next request tells OpenLobs nothing is possible), and a quit ends the loop.
 */
export async function run(config: Config, deps: Deps, signal: AbortSignal, reload?: () => Config | null, watchMs = 500): Promise<'stopped' | 'disconnected'> {
  const running = new Map<string, Running>()
  const inner = new AbortController()
  if (signal.aborted) inner.abort()
  else signal.addEventListener('abort', () => inner.abort(), { once: true })
  let wasPaused = false
  let connected = false
  let current: Config = config
  const publish = () => deps.control?.publish({
    version: BRIDGE_VERSION, name: current.name, server: current.server, connected, paused: wasPaused,
    busy: [...running.values()].map(r => HANDLERS[r.kind]?.label ?? r.kind)[0] ?? null, at: deps.now().toISOString()
  })
  const watch = setInterval(() => {
    const paused = deps.control?.paused() ?? false
    if (paused && !wasPaused) {
      deps.log('Paused from the tray icon: stopping everything.')
      // Running work stops now. The waiting request is left alone: ending it mid-wait could lose a job the server had just handed over.
      for (const r of running.values()) r.controller.abort()
    } else if (!paused && wasPaused) {
      deps.log('Resumed.')
    }
    wasPaused = paused
    if (deps.control?.quitRequested()) { deps.log('Quit from the tray icon.'); inner.abort() }
    publish()
  }, watchMs)
  let wait = 1000
  deps.log(`Connected as "${config.name}". Waiting for OpenLobs. Press Ctrl+C to stop.`)
  try {
    while (!inner.signal.aborted) {
      try {
        // What is allowed can change while the Bridge runs (bridge allow browser), so read it fresh each round.
        const fresh = reload?.()
        current = { ...config, allow: fresh?.allow ?? config.allow, workspace: fresh ? fresh.workspace : config.workspace }
        if (!(await pollOnce(current, deps, running, inner.signal))) { deps.log('This computer was disconnected from OpenLobs.'); connected = false; publish(); return 'disconnected' }
        connected = true
        wait = 1000
      } catch (err: any) {
        if (inner.signal.aborted) break
        if (err instanceof AuthError) { deps.log(err.message); connected = false; publish(); return 'disconnected' }
        connected = false
        deps.log(`Cannot reach OpenLobs (${String(err?.message ?? err).slice(0, 100)}). Trying again in ${Math.round(wait / 1000)} s.`)
        publish()
        await deps.sleep(wait, inner.signal)
        wait = Math.min(wait * 2, 60_000)
      }
    }
  } finally {
    clearInterval(watch)
  }
  // Stopping the Bridge stops whatever it was doing.
  for (const r of running.values()) r.controller.abort()
  connected = false
  publish()
  return 'stopped'
}

/** Tells OpenLobs to forget this computer. Local files are removed by the caller. */
export async function disconnect(config: Config, deps: Deps): Promise<void> {
  await call(config, deps, '/api/bridge/disconnect', {})
}
