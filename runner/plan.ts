import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCommand } from '../bridge/run'
import { boxRequestSchema } from '../shared/cloudBox'
import type { BoxResponse } from '../shared/cloudBox'
import { RUN_LIMITS, checkStep, isSecretFile } from '../shared/runPlan'

/**
 * Runs one plan in an empty, throw-away folder and returns what each step printed.
 *
 * It uses the very same code as the Bridge on a person's computer (bridge/run.ts and the rulebook in shared/runPlan.ts),
 * so a plan means the same thing in both places. What is different here:
 *  - the folder is brand new and is deleted afterwards, so nothing is kept between plans or people;
 *  - the programs start as an ordinary user (when this worker starts as root), so they cannot read this worker's
 *    own secret from its process, and the files they make belong to them alone;
 *  - the home folder, caches and temporary files all sit inside the throw-away folder.
 * The caller (server.ts) also restarts the worker after every plan, so a program that left something behind
 * (a background process, a changed global setting) does not reach the next person.
 */
export interface BoxDeps {
  /** Where throw-away folders are made. */
  workRoot?: string
  uid?: number
  gid?: number
  /** Extra values the programs may see, on top of a short clean list (PATH and the like). */
  env?: NodeJS.ProcessEnv
}

export async function runBoxPlan(raw: unknown, signal: AbortSignal, deps: BoxDeps = {}): Promise<BoxResponse> {
  const parsed = boxRequestSchema.safeParse(raw)
  if (!parsed.success) return { steps: [], error: (parsed.error.issues[0]?.message || 'That plan could not be read.').slice(0, 300) }
  const { steps, files, limitMs } = parsed.data
  for (const [i, s] of steps.entries()) {
    const c = checkStep(s, { devNull: os.devNull })
    if (!c.ok) return { steps: [], error: `Step ${i + 1}: ${c.error}`.slice(0, 300) }
  }

  const work = fs.realpathSync(fs.mkdtempSync(path.join(deps.workRoot ?? os.tmpdir(), 'box-')))
  const project = path.join(work, 'project')
  const home = path.join(work, 'home')
  const tmp = path.join(work, 'tmp')
  const own = (p: string) => { if (deps.uid !== undefined) fs.chownSync(p, deps.uid, deps.gid ?? deps.uid) }
  const out: BoxResponse = { steps: [] }
  try {
    // The throw-away folder is a private room: only the user the programs run as (and root) can get in.
    for (const d of [work, project, home, tmp]) { if (d !== work) fs.mkdirSync(d); own(d); fs.chmodSync(d, 0o700) }
    for (const f of files) {
      if (isSecretFile(f.path)) return { steps: [], error: `"${f.path}" is not allowed.` }
      const full = path.resolve(project, ...f.path.split('/'))
      if (path.relative(project, full).startsWith('..')) return { steps: [], error: `"${f.path}" is outside the folder.` }
      // Make each parent folder, and give the programs' user everything created.
      let dir = path.dirname(full)
      const made: string[] = []
      while (dir !== project && !fs.existsSync(dir)) { made.push(dir); dir = path.dirname(dir) }
      fs.mkdirSync(path.dirname(full), { recursive: true })
      for (const d of made) own(d)
      fs.writeFileSync(full, f.content, { flag: 'wx' })
      own(full)
    }

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      HOME: home,
      TMPDIR: tmp,
      npm_config_cache: path.join(home, '.npm'),
      PIP_CACHE_DIR: path.join(home, '.cache', 'pip'),
      ...deps.env
    }
    const started = Date.now()
    for (const [i, step] of steps.entries()) {
      const left = limitMs - (Date.now() - started)
      if (left < 10_000) { out.error = `There was not enough time left to start step ${i + 1}.`; break }
      const checked = checkStep(step, { devNull: os.devNull })
      if (!checked.ok) { out.error = checked.error.slice(0, 300); break }
      const stepLimit = Math.max(5_000, Math.min(checked.step.timeoutMs, left, RUN_LIMITS.installMs))
      try {
        const r = await runCommand(project, { ...step, limitMs: stepLimit }, signal, { env, uid: deps.uid, gid: deps.gid })
        out.steps.push({ n: i + 1, exitCode: r.exitCode, timedOut: r.timedOut, ms: r.ms, output: r.output, outputTruncated: r.outputTruncated })
        if (r.exitCode !== 0 || r.timedOut) break
      } catch (err: any) {
        out.steps.push({ n: i + 1, exitCode: null, timedOut: false, ms: 0, output: '', outputTruncated: false, error: String(err?.message || 'The step could not start.').slice(0, 300) })
        break
      }
    }
    return out
  } finally {
    await endLeftovers(deps.uid)
    fs.rmSync(work, { recursive: true, force: true })
  }
}

/** Stops anything the programs left running. Best effort: the worker is restarted after the plan anyway. */
function endLeftovers(uid: number | undefined): Promise<void> {
  if (uid === undefined || uid === 0) return Promise.resolve()
  return new Promise(resolve => execFile('pkill', ['-9', '-u', String(uid)], () => resolve()))
}
