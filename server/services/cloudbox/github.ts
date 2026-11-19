import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { boxRequestSchema, boxResponseSchema } from '../../../shared/cloudBox'
import type { BoxResponse } from '../../../shared/cloudBox'
import { ZipError, readZipEntry } from '../../utils/zip'
import { MAX_PACKED_CHARS, RESULT_ARTIFACT, RUNNER_FILES, RUNNER_REPO, WORKFLOW_FILE } from './githubWorkflow'

/**
 * Runs a plan on the person's own GitHub: a private repo of theirs (openlobs-runs) with one workflow that OpenLobs
 * starts, using a token that can reach that one repo and nothing else. GitHub's machine runs the plan with the same
 * runner and rulebook as the OpenLobs cloud box, uploads what each step printed, and OpenLobs reads it and deletes the run.
 *
 * Why the person's own GitHub: GitHub's terms say its machines may only serve the project of the repo they run in, so
 * one OpenLobs account running other people's jobs would be a breach. Their account, their repo, their free minutes.
 *
 * Everything here talks to api.github.com only. The token is never put in a message, a log or an error.
 */

const API = 'https://api.github.com'
const TOKEN_SHAPE = /^github_pat_[A-Za-z0-9_]{20,300}$/

/** A problem in plain words, safe to show the person. `kind` says what they can do about it. */
export class GithubRunError extends Error {
  constructor(message: string, readonly kind: 'token' | 'repo' | 'permission' | 'busy' | 'size' | 'other' = 'other') { super(message) }
}

export interface GithubDeps {
  fetch?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason)
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
})

interface Reply { status: number, json: any, headers: Headers }

function client(token: string, deps: GithubDeps) {
  const f = deps.fetch ?? fetch
  async function call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Reply> {
    let res: Response
    try {
      res = await f(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'OpenLobs',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)])
      })
    } catch (err: any) {
      if (signal?.aborted) throw err
      throw new GithubRunError('GitHub could not be reached. Nothing was run. Try again in a moment.')
    }
    const text = await res.text().catch(() => '')
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { /* a redirect or an empty answer has no body */ }
    return { status: res.status, json, headers: res.headers }
  }
  return { call, fetch: f }
}

/** Turns an unexpected answer into words. Never includes the token. */
function explain(res: Reply, what: string): GithubRunError {
  const message = String(res.json?.message || '')
  if (res.status === 401) return new GithubRunError('GitHub refused the token. It may have expired or been deleted. Make a new one in Settings.', 'token')
  if (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit|abuse/i.test(message))) return new GithubRunError('GitHub says there have been too many requests. Try again in a minute.', 'busy')
  if (res.status === 403) return new GithubRunError(`The token is not allowed to ${what} in ${RUNNER_REPO}. Give it Actions, Contents and Workflows access (read and write) for that repo only.`, 'permission')
  if (res.status === 404) return new GithubRunError(`GitHub could not find ${RUNNER_REPO} to ${what}. Check that the repo exists and that the token is for it.`, 'repo')
  if (res.status === 429) return new GithubRunError('GitHub says there have been too many requests. Try again in a minute.', 'busy')
  return new GithubRunError(`GitHub could not ${what} (it answered ${res.status}).`)
}

export interface Connection {
  login: string
  repo: string
  defaultBranch: string
}

/**
 * Checks a token before anything is stored. It must be a fine-grained token, it must reach exactly one repository,
 * and that repository must be the private openlobs-runs of the token's owner with write access.
 */
export async function checkConnection(token: string, deps: GithubDeps = {}): Promise<Connection> {
  const t = token.trim()
  if (/^(ghp_|gho_|ghu_|ghs_|ghr_)/.test(t)) throw new GithubRunError('That is a classic token, which can reach all of your repositories. Make a fine-grained token for openlobs-runs only.', 'token')
  if (!TOKEN_SHAPE.test(t)) throw new GithubRunError('That does not look like a GitHub fine-grained token. It starts with github_pat_.', 'token')
  const { call } = client(t, deps)

  const me = await call('GET', '/user')
  if (me.status !== 200) throw explain(me, 'check the token')
  const login = String(me.json?.login || '')
  if (!login) throw new GithubRunError('GitHub did not say whose token this is.')
  const full = `${login}/${RUNNER_REPO}`.toLowerCase()

  // A token for one repository lists exactly that one. Anything more means it is broader than it should be.
  const reach = await call('GET', '/user/repos?per_page=100')
  if (reach.status !== 200 || !Array.isArray(reach.json)) throw explain(reach, 'check what the token can reach')
  const names: string[] = reach.json.map((r: any) => String(r?.full_name || '').toLowerCase())
  const others = names.filter(n => n !== full)
  if (others.length || reach.headers.get('link')?.includes('rel="next"')) {
    throw new GithubRunError(`This token can reach more than ${RUNNER_REPO}${others[0] ? ` (for example ${others[0].split('/')[1]})` : ''}. Make a new fine-grained token and choose "Only select repositories", then pick ${RUNNER_REPO}.`, 'token')
  }
  if (!names.includes(full)) throw new GithubRunError(`The token cannot see ${RUNNER_REPO}. Under "Repository access" choose "Only select repositories" and pick it.`, 'repo')

  const repo = await call('GET', `/repos/${login}/${RUNNER_REPO}`)
  if (repo.status === 404) throw new GithubRunError(`${RUNNER_REPO} was not found in your GitHub. Make it first (private), then try again.`, 'repo')
  if (repo.status !== 200) throw explain(repo, 'open the repo')
  if (repo.json?.private !== true) throw new GithubRunError(`${RUNNER_REPO} is public. Make it private first: anyone could read what runs in a public repo.`, 'repo')
  if (repo.json?.archived) throw new GithubRunError(`${RUNNER_REPO} is archived. Unarchive it, or make a new one.`, 'repo')
  if (!repo.json?.permissions?.push) throw new GithubRunError(`The token can only read ${RUNNER_REPO}. It needs Contents access to write.`, 'permission')
  return { login, repo: RUNNER_REPO, defaultBranch: String(repo.json?.default_branch || 'main') }
}

/** Writes the workflow and the run script into the repo when they are missing or out of date. Returns whether anything changed. */
export async function installRunner(token: string, conn: Connection, deps: GithubDeps = {}): Promise<{ changed: boolean }> {
  const { call } = client(token, deps)
  let changed = false
  for (const file of RUNNER_FILES) {
    const path = `/repos/${conn.login}/${conn.repo}/contents/${file.path}`
    const current = await call('GET', `${path}?ref=${encodeURIComponent(conn.defaultBranch)}`)
    let sha: string | undefined
    if (current.status === 200 && current.json?.sha) {
      const same = typeof current.json.content === 'string' && Buffer.from(current.json.content, 'base64').toString('utf8') === file.content
      if (same) continue
      sha = String(current.json.sha)
    } else if (current.status !== 404) throw explain(current, 'read the runner files')
    const put = await call('PUT', path, {
      message: sha ? 'OpenLobs: update the runner' : 'OpenLobs: set up the runner',
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {})
    })
    if (put.status !== 200 && put.status !== 201) {
      if (put.status === 404 || put.status === 403) throw new GithubRunError(`The token could not write the runner into ${conn.repo}. It needs Contents and Workflows access (read and write) for that repo.`, 'permission')
      throw explain(put, 'write the runner')
    }
    changed = true
  }
  // Actions has to be allowed to read workflows, or nothing could ever be started.
  const flows = await call('GET', `/repos/${conn.login}/${conn.repo}/actions/workflows`)
  if (flows.status === 403 || flows.status === 404) throw new GithubRunError(`The token cannot use Actions in ${conn.repo}. Give it Actions access (read and write), and check that Actions is switched on for the repo.`, 'permission')
  return { changed }
}

export interface GithubReply extends BoxResponse {
  /** Seconds from sending the plan to having the answer. */
  seconds: number
  /** About how many of GitHub's free minutes this used (GitHub rounds each job up to a whole minute). */
  minutes: number
}

export interface GithubBox {
  name: string
  run(req: unknown, signal?: AbortSignal): Promise<GithubReply>
}

const START_WAIT_MS = 90_000

/** Packs a plan the way the run script unpacks it: JSON, gzip, base64. */
export function packPlan(plan: unknown): string {
  const packed = gzipSync(Buffer.from(JSON.stringify(plan), 'utf8')).toString('base64')
  if (packed.length > MAX_PACKED_CHARS) throw new GithubRunError('This plan is too big to send to GitHub. Use fewer or smaller files and try again.', 'size')
  return packed
}

export function githubBox(conn: Connection, token: string, deps: GithubDeps = {}): GithubBox {
  const { call, fetch: f } = client(token, deps)
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const base = `/repos/${conn.login}/${conn.repo}`

  async function cancel(runId: number | null) {
    if (runId === null) return
    await call('POST', `${base}/actions/runs/${runId}/cancel`).catch(() => {})
  }

  async function readResult(runId: number, signal?: AbortSignal): Promise<BoxResponse | null> {
    // The artifact can take a moment to be listed after the run ends.
    for (let tries = 0; tries < 4; tries++) {
      const list = await call('GET', `${base}/actions/runs/${runId}/artifacts`, undefined, signal)
      if (list.status !== 200) throw explain(list, 'read the result')
      const found = (list.json?.artifacts ?? []).find((a: any) => a?.name === RESULT_ARTIFACT && !a?.expired)
      if (found) return downloadResult(Number(found.id), signal)
      if (tries < 3) await sleep(2_000, signal)
    }
    return null
  }

  async function downloadResult(artifactId: number, signal?: AbortSignal): Promise<BoxResponse> {
    const first = await f(`${API}${base}/actions/artifacts/${artifactId}/zip`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'OpenLobs' },
      redirect: 'manual',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)])
    }).catch(() => { throw new GithubRunError('GitHub could not be reached to read the result.') })
    if (first.status !== 302 && first.status !== 301) throw explain({ status: first.status, json: null, headers: first.headers }, 'read the result')
    let target: URL
    try { target = new URL(first.headers.get('location') || '') } catch { throw new GithubRunError('GitHub sent the result from an unexpected place.') }
    // The file is served from GitHub's own storage. The token is not sent there, and nothing else is trusted.
    if (target.protocol !== 'https:' || !/(^|\.)(githubusercontent\.com|blob\.core\.windows\.net|github\.com)$/i.test(target.hostname)) throw new GithubRunError('GitHub sent the result from an unexpected place.')
    const file = await f(target, { redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]) })
      .catch(() => { throw new GithubRunError('GitHub could not be reached to read the result.') })
    if (!file.ok) throw new GithubRunError('GitHub could not give the result back.')
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length > 2_000_000) throw new GithubRunError('The result was larger than expected, so it was not read.')
    let body: unknown
    try { body = JSON.parse(readZipEntry(bytes, n => n === 'result.json' || n.endsWith('/result.json')).toString('utf8')) } catch (err) {
      throw new GithubRunError(err instanceof ZipError ? 'The result from GitHub could not be read.' : 'The result from GitHub was not understood.')
    }
    const reply = boxResponseSchema.safeParse(body)
    if (!reply.success) throw new GithubRunError('The result from GitHub was not understood.')
    return reply.data
  }

  return {
    name: 'your GitHub',
    async run(raw, signal) {
      const req = boxRequestSchema.safeParse(raw)
      if (!req.success) throw new GithubRunError(req.error.issues[0]?.message || 'That plan could not be sent to GitHub.')
      const packed = packPlan(req.data)
      const runId = randomUUID()
      const title = `openlobs ${runId}`
      const t0 = now()
      const deadline = t0 + req.data.limitMs + START_WAIT_MS
      let ghRun: number | null = null
      try {
        // A workflow written a moment ago may not be known yet; ask again a couple of times before giving up.
        for (let tries = 0; ; tries++) {
          const sent = await call('POST', `${base}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref: conn.defaultBranch, inputs: { run_id: runId, plan: packed } }, signal)
          if (sent.status === 204) break
          if ((sent.status === 404 || sent.status === 422) && tries < 2) { await sleep(3_000, signal); continue }
          if (sent.status === 404 || sent.status === 422) throw new GithubRunError(`GitHub did not find the OpenLobs workflow in ${conn.repo}. Open Settings and press "Check again" to put it back.`, 'repo')
          throw explain(sent, 'start the run')
        }

        // Starting a run does not say which run it is, so find the one with this plan's title.
        while (ghRun === null) {
          if (now() > t0 + START_WAIT_MS) throw new GithubRunError('GitHub did not start the run in time. Nothing ran.', 'busy')
          await sleep(2_000, signal)
          const list = await call('GET', `${base}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=10`, undefined, signal)
          if (list.status !== 200) throw explain(list, 'find the run')
          const hit = (list.json?.workflow_runs ?? []).find((r: any) => r?.display_title === title || r?.name === title)
          if (hit) ghRun = Number(hit.id)
        }

        let run: any = null
        while (true) {
          const got = await call('GET', `${base}/actions/runs/${ghRun}`, undefined, signal)
          if (got.status !== 200) throw explain(got, 'follow the run')
          run = got.json
          if (run?.status === 'completed') break
          if (now() > deadline) {
            await cancel(ghRun)
            // A stopped run can be deleted once it has ended, which takes a moment.
            await sleep(3_000, signal).then(() => call('DELETE', `${base}/actions/runs/${ghRun}`)).catch(() => {})
            throw new GithubRunError('GitHub took too long, so the run was stopped. Nothing finished. Try again, or split the work into smaller plans.', 'busy')
          }
          await sleep(now() - t0 < 30_000 ? 2_000 : 4_000, signal)
        }

        let reply: BoxResponse | null
        try { reply = await readResult(ghRun, signal) } finally {
          // The run and its log hold the plan and what it printed. Whatever came of reading the result, OpenLobs is done with it,
          // so it is removed from the person's repo.
          await call('DELETE', `${base}/actions/runs/${ghRun}`).catch(() => {})
        }
        const seconds = Math.round((now() - t0) / 100) / 10
        if (!reply) {
          throw new GithubRunError(run?.conclusion === 'cancelled'
            ? 'The run was cancelled on GitHub, so nothing finished.'
            : 'GitHub ran the job but it gave no result. It may have run out of time or failed to start. Nothing finished.')
        }
        const started = Date.parse(run?.run_started_at ?? '')
        const ended = Date.parse(run?.updated_at ?? '')
        const billed = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? (ended - started) / 1000 : seconds
        return { ...reply, seconds, minutes: Math.max(1, Math.ceil(billed / 60)) }
      } catch (err) {
        // Giving up (or the person closing the chat) stops the run on GitHub as well, so it does not keep using their minutes.
        if (signal?.aborted) await cancel(ghRun)
        throw err
      }
    }
  }
}
