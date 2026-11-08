import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RUN_LIMITS, checkStep, cleanEnv, isSecretFile, redact, relPath, runJobInputSchema, tailOutput } from '../shared/runPlan'
import type { CheckedStep } from '../shared/runPlan'
import { WorkspaceError, isInside, openWorkspace, resolveDir, resolveExisting } from './workspace'

/**
 * Running approved commands on this computer, inside one folder the person chose.
 *
 * What it does for every command, whatever the server says:
 *  - checks the step again with the same rulebook the server used (shared/runPlan.ts): program, sub-command and
 *    every option must be on the allow-list;
 *  - starts the program directly with its arguments as a list (no shell, so nothing in them can be a second command);
 *  - works inside the chosen folder (or a folder in it), with a clean environment: no tokens, keys or other apps' settings;
 *  - stops it when the time is up, when the person cancels or pauses, or when the Bridge stops, including everything it started;
 *  - keeps only the end of the output, with anything that looks like a password or key hidden.
 *
 * What it cannot do: a program the person approved (a script, a test run, a package's setup code) runs with the
 * same access as the person's own account. The folder is where it starts and where the Bridge lets OpenLobs look,
 * not a wall around what that program can touch. That is why every plan is approved first, and why packages are
 * installed with their own setup code switched off unless the person allows it for that step.
 */

export interface RunDeps {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** Start programs as this (unprivileged) user. Used by the cloud box worker, which itself starts as root so its own secret stays out of reach. */
  uid?: number
  gid?: number
}

export interface RunOutput { exitCode: number, timedOut: boolean, ms: number, output: string, outputTruncated: boolean }

/** One command at a time on this computer: two installs in one folder would trip over each other. */
let chain: Promise<unknown> = Promise.resolve()
const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn)
  chain = next.catch(() => {})
  return next
}

function isFile(p: string, mustRun: boolean): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false
    if (mustRun) fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch { return false }
}

/** Finds a program on the PATH. On Windows only real programs (.exe), never .cmd or .bat files, which would need a shell. */
export function which(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const win = platform === 'win32'
  const dirs = String(env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.join(dir.replace(/^"|"$/g, ''), win && !/\.(exe|com)$/i.test(name) ? `${name}.exe` : name)
    if (isFile(candidate, !win)) return candidate
  }
  return null
}

interface Launch { exe: string, lead: string[], extraPath: string[], env: Record<string, string> }

function launchFor(step: CheckedStep, root: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Launch {
  const win = platform === 'win32'
  const missing = (what: string) => new Error(`Could not find ${what} on this computer. Install it first, then ask again.`)
  if (step.venv) {
    // A Python environment inside the project: its own python and pip, found in the environment's folder.
    let dir = ''
    try { dir = resolveDir(root, step.venv) } catch { /* reported just below, with the fix */ }
    if (!dir || !fs.existsSync(path.join(dir, 'pyvenv.cfg'))) throw new Error(`"${step.venv}" is not a Python environment yet. Create it first with: python -m venv ${step.venv}`)
    const bin = path.join(dir, win ? 'Scripts' : 'bin')
    const names = step.program.startsWith('pip') ? ['pip', 'pip3'] : ['python', 'python3']
    const exe = names.map(n => path.join(bin, win ? `${n}.exe` : n)).find(p => isFile(p, !win))
    if (!exe) throw missing(`Python in "${step.venv}"`)
    return { exe, lead: [], extraPath: [bin], env: { VIRTUAL_ENV: dir } }
  }
  if (step.program === 'npm' && win) {
    // npm on Windows is a .cmd file, which cannot be started without a shell. Its real program is a script that Node runs.
    const nodeExe = which('node', env, platform)
    const cli = nodeExe ? path.join(path.dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npm-cli.js') : ''
    if (!nodeExe || !isFile(cli, false)) throw missing('npm')
    return { exe: nodeExe, lead: [cli], extraPath: [], env: {} }
  }
  if (step.program === 'node') {
    const exe = which('node', env, platform) ?? (/^node(\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : null)
    if (!exe) throw missing('Node.js')
    return { exe, lead: [], extraPath: [], env: {} }
  }
  const exe = which(step.program, env, platform)
  if (!exe) {
    const hint = step.program === 'python' ? ' (on some computers it is called python3)' : step.program === 'pip' ? ' (it may be called pip3)' : win && (step.program === 'pnpm' || step.program === 'yarn') ? '. On Windows only npm is supported for now' : ''
    throw missing(`${step.program}${hint}`)
  }
  return { exe, lead: [], extraPath: [], env: {} }
}

/** A file named in a step, followed to where it really is: it must be inside the chosen folder, even through shortcuts. */
function mustBeInside(root: string, cwd: string, rel: string) {
  const full = path.resolve(cwd, rel)
  if (!isInside(root, full)) throw new WorkspaceError('That file is outside the chosen folder.')
  let real: string
  try { real = fs.realpathSync(full) } catch { throw new WorkspaceError(`There is no file "${rel}" there.`) }
  if (!isInside(root, real)) throw new WorkspaceError('That file is outside the chosen folder.')
}

function filesNamed(step: CheckedStep): string[] {
  const a = step.argv
  if (step.program === 'node') return a[0] && !a[0].startsWith('-') ? [a[0]] : []
  if (step.program === 'python' || step.program === 'python3') return a[0] && !a[0].startsWith('-') ? [a[0]] : []
  if (step.program === 'pip' || step.program === 'pip3' || a[0] === '-m') return a.flatMap((x, i) => (x === '-r' && a[i + 1] ? [a[i + 1]!] : []))
  return []
}

function killTree(child: ReturnType<typeof spawn>, platform: NodeJS.Platform) {
  const pid = child.pid
  if (!pid) return
  if (platform === 'win32') { execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {}); return }
  try { process.kill(-pid, 'SIGTERM') } catch { /* already gone */ }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }, 2000).unref()
}

const KEEP = 40_000
const FLOOD = 60_000_000

function exec(exe: string, argv: string[], opts: { cwd: string, env: Record<string, string>, timeoutMs: number, signal: AbortSignal, platform: NodeJS.Platform, uid?: number, gid?: number }): Promise<{ exitCode: number, timedOut: boolean, stopped: boolean, text: string, total: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, argv, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: opts.platform !== 'win32', shell: false, ...(opts.uid !== undefined ? { uid: opts.uid } : {}), ...(opts.gid !== undefined ? { gid: opts.gid } : {}) })
    let text = ''
    let total = 0
    let timedOut = false
    let stopped = false
    let done = false
    let hardStop: ReturnType<typeof setTimeout> | undefined
    const finish = (exitCode: number) => {
      if (done) return
      done = true
      clearTimeout(timer); clearTimeout(hardStop)
      opts.signal.removeEventListener('abort', onAbort)
      resolve({ exitCode, timedOut, stopped, text, total })
    }
    // Stopping ends the whole group of programs it started. If something ignores that, stop waiting after a few seconds.
    const halt = () => { killTree(child, opts.platform); hardStop ??= setTimeout(() => finish(137), 5000) }
    const take = (chunk: string) => { total += chunk.length; text = (text + chunk).slice(-KEEP); if (total > FLOOD) { stopped = true; halt() } }
    const onAbort = () => { stopped = true; halt() }
    child.stdout!.setEncoding('utf8').on('data', take)
    child.stderr!.setEncoding('utf8').on('data', take)
    const timer = setTimeout(() => { timedOut = true; halt() }, opts.timeoutMs)
    if (opts.signal.aborted) onAbort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer); clearTimeout(hardStop)
      opts.signal.removeEventListener('abort', onAbort)
      reject(new Error(`Could not start the program: ${String(err.message).slice(0, 120)}`))
    })
    child.on('close', (code, sig) => finish(code ?? (sig ? 143 : 1)))
  })
}

/** Runs one approved step. Throws a message fit for a person when it cannot start or was stopped. */
export function runCommand(rootFolder: string | null | undefined, raw: unknown, signal: AbortSignal, deps: RunDeps = {}): Promise<RunOutput> {
  return oneAtATime(async () => {
    const env = deps.env ?? process.env
    const platform = deps.platform ?? process.platform
    const parsed = runJobInputSchema.safeParse(raw)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'That is not a valid step.')
    const { limitMs, ...stepInput } = parsed.data
    const checked = checkStep(stepInput, { devNull: os.devNull })
    if (!checked.ok) throw new Error(checked.error)
    const step = checked.step

    const root = openWorkspace(rootFolder, 'run')
    const cwd = step.cwd ? resolveDir(root, step.cwd) : root
    const launch = launchFor(step, root, env, platform)
    for (const f of filesNamed(step)) mustBeInside(root, cwd, f)

    const base = cleanEnv(env as Record<string, string | undefined>, { ...step.env, ...launch.env })
    if (launch.extraPath.length) base.PATH = [...launch.extraPath, base.PATH ?? ''].join(platform === 'win32' ? ';' : ':')
    // Git looks upward for a project. Stop it at the chosen folder so it never finds (and changes) one outside it.
    if (step.program === 'git') base.GIT_CEILING_DIRECTORIES = path.dirname(root)

    const started = Date.now()
    const out = await exec(launch.exe, [...launch.lead, ...step.argv], { cwd, env: base, timeoutMs: Math.min(step.timeoutMs, limitMs ?? step.timeoutMs), signal, platform, uid: deps.uid, gid: deps.gid })
    if (out.stopped && signal.aborted) throw new Error('Stopped.')
    const tail = tailOutput(redact(out.text))
    return { exitCode: out.exitCode, timedOut: out.timedOut, ms: Date.now() - started, output: tail.text, outputTruncated: tail.cut || out.total > KEEP }
  })
}

// ---- Looking in the folder (read-only) ----

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.cache', 'dist', 'build', 'target', '.idea', '.vscode'])

export interface FolderEntry { name: string, type: 'file' | 'folder', sizeKb?: number }

/** Lists the chosen folder (or one inside it), two levels deep. Secret files and shortcuts are not listed; build and package folders are named but not opened. */
export function folderLook(rootFolder: string | null | undefined, input: unknown): { path: string, entries: FolderEntry[], truncated: boolean, hidden: number } {
  const i = (input && typeof input === 'object' ? input : {}) as { path?: unknown, depth?: unknown }
  const root = openWorkspace(rootFolder, 'run')
  const rel = typeof i.path === 'string' && i.path.trim() && i.path.trim() !== '.' ? relPath(i.path) : ''
  const start = rel ? resolveDir(root, rel) : root
  const depth = i.depth === 1 ? 1 : 2
  const entries: FolderEntry[] = []
  let hidden = 0
  const walk = (dir: string, level: number) => {
    let items: fs.Dirent[] = []
    try { items = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of items) {
      if (entries.length >= RUN_LIMITS.maxListed) return
      if (e.isSymbolicLink()) { hidden++; continue }
      const full = path.join(dir, e.name)
      const name = path.relative(root, full).split(path.sep).join('/')
      if (isSecretFile(name)) { hidden++; continue }
      if (e.name === '.git') continue
      if (e.isDirectory()) {
        entries.push({ name: `${name}/`, type: 'folder' })
        if (level < depth && !SKIP_DIRS.has(e.name)) walk(full, level + 1)
      } else if (e.isFile()) {
        try { entries.push({ name, type: 'file', sizeKb: Math.max(1, Math.ceil(fs.statSync(full).size / 1024)) }) } catch { /* vanished */ }
      }
    }
  }
  walk(start, 1)
  return { path: rel || '.', entries, truncated: entries.length >= RUN_LIMITS.maxListed, hidden }
}

/** Reads one text file from the chosen folder. Secret files and binary files are refused. Anything that looks like a key is hidden. */
export function folderRead(rootFolder: string | null | undefined, input: unknown): { name: string, text: string, truncated: boolean, sizeKb: number } {
  const i = (input && typeof input === 'object' ? input : {}) as { file?: unknown }
  if (typeof i.file !== 'string' || !i.file.trim()) throw new Error('Say which file to read.')
  const root = openWorkspace(rootFolder, 'run')
  const rel = relPath(i.file, 'file')
  if (isSecretFile(rel)) throw new WorkspaceError('That file holds passwords or keys, so it is never read.')
  const full = resolveExisting(root, rel)
  const realRel = path.relative(root, full).split(path.sep).join('/')
  if (isSecretFile(realRel)) throw new WorkspaceError('That file holds passwords or keys, so it is never read.')
  const size = fs.statSync(full).size
  if (size > 2_000_000) throw new WorkspaceError('That file is too large to read here.')
  const fd = fs.openSync(full, 'r')
  try {
    const buf = Buffer.alloc(Math.min(size, RUN_LIMITS.maxReadChars * 4))
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    if (buf.subarray(0, Math.min(n, 4000)).includes(0)) throw new WorkspaceError('That looks like a binary file, not text.')
    const all = redact(buf.subarray(0, n).toString('utf8'))
    const text = all.slice(0, RUN_LIMITS.maxReadChars)
    return { name: realRel, text, truncated: all.length > text.length || size > n, sizeKb: Math.max(1, Math.ceil(size / 1024)) }
  } finally { fs.closeSync(fd) }
}

/** A folder is only suitable for running commands if it is a project folder, not the whole computer or the person's whole home. */
export function checkRunFolder(real: string): string {
  const normal = real.replace(/[\\/]+$/, '') || real
  const lower = normal.toLowerCase().replace(/\\/g, '/')
  const home = os.homedir().replace(/[\\/]+$/, '').toLowerCase().replace(/\\/g, '/')
  const tooBroad = path.parse(real).root === real
    || /^[a-z]:$/.test(lower)
    || lower === home
    || ['/etc', '/usr', '/bin', '/sbin', '/var', '/opt', '/lib', '/boot', '/root', '/home', '/users', '/system', '/library', '/applications'].includes(lower)
    || /^[a-z]:\/(windows|program files|program files \(x86\)|users|programdata)?$/.test(lower)
    || /^[a-z]:\/(windows|program files|program files \(x86\)|programdata)(\/|$)/.test(lower)
    || ['/etc', '/usr', '/bin', '/sbin', '/var', '/boot', '/system', '/library'].some(d => lower.startsWith(`${d}/`))
  if (tooBroad) throw new WorkspaceError(`"${real}" is too broad. Choose a folder for one project, for example a new folder named "OpenLobs projects" inside your Documents.`)
  return real
}
