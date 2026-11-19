import { deflateRawSync, gunzipSync } from 'node:zlib'
import { runBoxPlan } from '../runner/plan'
import type { BoxResponse } from '../shared/cloudBox'

/**
 * A stand-in for the parts of api.github.com that the "run on your GitHub" feature uses: the user, the repos a token
 * can reach, files in a repo, a workflow that can be started, runs that move from queued to completed, and an artifact
 * zip that is handed out from a second host. It is not GitHub: it proves our calls and our reading of the answers,
 * not GitHub's own behaviour. By default a finished run holds what the real run script would have written, made by
 * running the plan for real with the same plan runner.
 */

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** A small .zip, written the way GitHub writes one (deflated entries, sizes in the central directory). */
export function makeZip(entries: Array<{ name: string, data: Buffer | string, store?: boolean }>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    const body = e.store ? raw : deflateRawSync(raw)
    const name = Buffer.from(e.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(e.store ? 0 : 8, 8)
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26)
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(e.store ? 0 : 8, 10)
    head.writeUInt32LE(crc32(raw), 16); head.writeUInt32LE(body.length, 20); head.writeUInt32LE(raw.length, 24); head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42)
    locals.push(local, name, body); central.push(head, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

export interface FakeRepo { full_name: string, private: boolean, archived?: boolean, push?: boolean, default_branch?: string }
export interface FakeRun { id: number, display_title: string, status: 'queued' | 'in_progress' | 'completed', conclusion: string | null, polls: number, inputs: any, run_started_at?: string, updated_at?: string }

export interface FakeGithubOptions {
  token?: string
  login?: string
  /** What the token can reach. Default: just the person's openlobs-runs. */
  repos?: FakeRepo[]
  /** Does the repo already have commits? An empty repo answers 404 for every file. */
  empty?: boolean
  /** Who may do what. */
  denyWrite?: boolean
  denyActions?: boolean
  /** Polls of a run before it completes. */
  finishAfter?: number
  /** Polls of the run list before the new run shows up. */
  listAfter?: number
  /** How the run ends. */
  conclusion?: string
  /** Hand out no artifact. */
  noArtifact?: boolean
  /** Replace what the run script would have written. */
  result?: (plan: any) => Promise<BoxResponse> | BoxResponse
  /** Dispatch answers this status this many times before it answers 204. */
  dispatchFails?: { status: number, times: number }
  /** The host the artifact redirect points at. */
  blobHost?: string
  /** Seconds a finished run is said to have taken (run_started_at to updated_at). */
  runSeconds?: number
}

export function fakeGithub(opts: FakeGithubOptions = {}) {
  const login = opts.login ?? 'richie'
  const token = opts.token ?? `github_pat_${'A'.repeat(40)}`
  const state = {
    login, token,
    repos: opts.repos ?? [{ full_name: `${login}/openlobs-runs`, private: true, push: true, default_branch: 'main' }] as FakeRepo[],
    files: new Map<string, { content: string, sha: string }>(),
    runs: [] as FakeRun[],
    requests: [] as Array<{ method: string, host: string, path: string, auth: string | null, body?: any }>,
    deleted: [] as number[],
    cancelled: [] as number[],
    commits: 0,
    dispatchFailures: opts.dispatchFails?.times ?? 0,
    clock: 1_000_000,
    nextRun: 5000,
    zips: new Map<number, Buffer>(),
    listCalls: 0
  }
  let shaN = 0
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

  async function finish(run: FakeRun) {
    run.status = 'completed'
    run.conclusion = opts.conclusion ?? 'success'
    run.run_started_at = new Date(state.clock).toISOString()
    run.updated_at = new Date(state.clock + (opts.runSeconds ?? 25) * 1000).toISOString()
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = (init?.method || 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const path = url.pathname + url.search
    state.requests.push({ method, host: url.host, path, auth: headers.get('authorization'), body })

    if (url.host === (opts.blobHost ?? 'productionresultssa1.blob.core.windows.net')) {
      const id = Number(url.pathname.split('/').pop())
      const zip = state.zips.get(id)
      return zip ? new Response(new Uint8Array(zip), { status: 200 }) : json(404, { message: 'Gone' })
    }
    if (url.host !== 'api.github.com') return json(404, { message: 'Unknown host' })
    if (headers.get('authorization') !== `Bearer ${state.token}`) return json(401, { message: 'Bad credentials' })

    const p = url.pathname
    if (p === '/user') return json(200, { login })
    if (p === '/user/repos') return json(200, state.repos.map(r => ({ full_name: r.full_name })))
    const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p)
    if (!repoMatch) return json(404, { message: 'Not Found' })
    const [, owner, name, rest = ''] = repoMatch
    const repo = state.repos.find(r => r.full_name.toLowerCase() === `${owner}/${name}`.toLowerCase())
    if (!repo) return json(404, { message: 'Not Found' })
    if (!rest) return json(200, { private: repo.private, archived: Boolean(repo.archived), default_branch: repo.default_branch ?? 'main', permissions: { push: repo.push !== false, pull: true } })

    if (rest.startsWith('/contents/')) {
      const file = decodeURIComponent(rest.slice('/contents/'.length))
      if (method === 'GET') {
        const f = state.files.get(file)
        if (!f || opts.empty && !state.commits) return json(404, { message: 'Not Found' })
        return json(200, { sha: f.sha, content: Buffer.from(f.content).toString('base64'), encoding: 'base64' })
      }
      if (method === 'PUT') {
        if (opts.denyWrite) return json(403, { message: 'Resource not accessible by personal access token' })
        const cur = state.files.get(file)
        if (cur && body.sha !== cur.sha) return json(409, { message: 'sha does not match' })
        state.files.set(file, { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha${++shaN}` })
        state.commits++
        return json(cur ? 200 : 201, { content: { path: file } })
      }
    }
    if (rest === '/actions/workflows' && method === 'GET') return opts.denyActions ? json(403, { message: 'Resource not accessible by personal access token' }) : json(200, { total_count: 1, workflows: [] })
    if (rest === '/actions/workflows/openlobs-run.yml/dispatches' && method === 'POST') {
      if (opts.denyActions) return json(403, { message: 'Resource not accessible by personal access token' })
      if (state.dispatchFailures > 0) { state.dispatchFailures--; return json(opts.dispatchFails!.status, { message: 'Workflow does not have workflow_dispatch trigger' }) }
      if (!state.files.has('.github/workflows/openlobs-run.yml')) return json(404, { message: 'Not Found' })
      state.runs.push({ id: state.nextRun++, display_title: `openlobs ${body.inputs.run_id}`, status: 'queued', conclusion: null, polls: 0, inputs: body.inputs })
      return new Response(null, { status: 204 })
    }
    if (rest === '/actions/workflows/openlobs-run.yml/runs' && method === 'GET') {
      state.listCalls++
      const visible = state.listCalls > (opts.listAfter ?? 0) ? [...state.runs].reverse() : []
      return json(200, { workflow_runs: visible.map(r => ({ id: r.id, display_title: r.display_title, name: r.display_title })) })
    }
    const runMatch = /^\/actions\/runs\/(\d+)(\/.*)?$/.exec(rest)
    if (runMatch) {
      const run = state.runs.find(r => r.id === Number(runMatch[1]))
      const sub = runMatch[2] ?? ''
      if (!run) return json(404, { message: 'Not Found' })
      if (method === 'DELETE' && !sub) { state.deleted.push(run.id); state.runs = state.runs.filter(r => r !== run); return new Response(null, { status: 204 }) }
      if (sub === '/cancel' && method === 'POST') { state.cancelled.push(run.id); run.status = 'completed'; run.conclusion = 'cancelled'; return json(202, {}) }
      if (sub === '/artifacts' && method === 'GET') {
        return json(200, { artifacts: run.status === 'completed' && !opts.noArtifact && state.zips.has(run.id) ? [{ id: run.id, name: 'openlobs-result', expired: false }] : [] })
      }
      if (!sub && method === 'GET') {
        run.polls++
        if (run.status !== 'completed' && opts.finishAfter !== Infinity) {
          if (run.polls > 1) run.status = 'in_progress'
          if (run.polls > (opts.finishAfter ?? 2)) await finish(run)
        }
        if (run.status === 'completed' && !state.zips.has(run.id) && run.conclusion !== 'cancelled') {
          const plan = JSON.parse(gunzipSync(Buffer.from(run.inputs.plan, 'base64')).toString('utf8'))
          const result = await (opts.result ? opts.result(plan) : runBoxPlan(plan, AbortSignal.timeout(60_000)))
          state.zips.set(run.id, makeZip([{ name: 'result.json', data: JSON.stringify(result) }]))
        }
        return json(200, { id: run.id, status: run.status, conclusion: run.conclusion, run_started_at: run.run_started_at, updated_at: run.updated_at })
      }
    }
    const artifactMatch = /^\/actions\/artifacts\/(\d+)\/zip$/.exec(rest)
    if (artifactMatch && method === 'GET') {
      return new Response(null, { status: 302, headers: { location: `https://${opts.blobHost ?? 'productionresultssa1.blob.core.windows.net'}/zips/${artifactMatch[1]}` } })
    }
    return json(404, { message: 'Not Found' })
  }
  return Object.assign(state, { fetch })
}

/** A clock that only moves when something waits, so polling loops finish instantly and timings stay exact. */
export function fakeTime() {
  let t = 1_000_000
  return { now: () => t, sleep: async (ms: number) => { t += ms }, get at() { return t } }
}
