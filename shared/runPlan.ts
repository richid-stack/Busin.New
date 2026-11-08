import { z } from 'zod'

/**
 * The rulebook for running commands on a person's own computer. Pure and shared: the server checks a plan with
 * it before the person is even asked, and the Bridge checks every step again on the computer itself with the
 * same code, so a step that breaks a rule is refused in both places.
 *
 * It is an allow-list, not a block-list. A program, a sub-command and each option must be named here to be run.
 * Anything else (a shell, `-e` code on the command line, global installs, `git push`, `npx`, a custom package
 * address) is refused with a reason a person can read. Arguments are only ever handed over as a list, never
 * through a shell, so nothing in them can be read as a second command.
 */

export const RUN_PROGRAMS = ['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'node', 'python', 'python3', 'git'] as const
export type RunProgram = typeof RUN_PROGRAMS[number]

export const RUN_LIMITS = {
  maxSteps: 8,
  maxArgs: 20,
  maxArgChars: 200,
  /** The most output kept from one command (the end of it, where the error usually is). */
  maxOutputChars: 6000,
  stepMs: 120_000,
  installMs: 180_000,
  /** A whole plan has to fit inside one chat request. Longer jobs are split into several plans. */
  planMs: 240_000,
  maxReadChars: 12_000,
  maxListed: 150
}

export type StepKind = 'install' | 'run' | 'read' | 'setup' | 'save' | 'fetch'

export interface CheckedStep {
  program: RunProgram
  /** What is handed to the program, after the rulebook added its own safety options. */
  argv: string[]
  /** The folder to work in, inside the chosen folder ('' is the chosen folder itself). */
  cwd: string
  /** A Python environment folder inside the chosen folder, if the step uses one. */
  venv: string | null
  kind: StepKind
  /** The step says what it does, in everyday words. */
  words: string
  /** Starts code that someone wrote (a script, a test run, a package's setup). That code can do what the person's account can. */
  runsCode: boolean
  installs: boolean
  network: boolean
  /** Packages may run their own setup code while installing (only when the person allowed it for this step). */
  setupScripts: boolean
  /** Extra settings for the program's environment. The Bridge adds a few more of its own. */
  env: Record<string, string>
  timeoutMs: number
}

export type StepCheck = { ok: true, step: CheckedStep } | { ok: false, error: string }

export const runStepSchema = z.object({
  program: z.enum(RUN_PROGRAMS),
  args: z.array(z.string().min(1).max(RUN_LIMITS.maxArgChars)).max(RUN_LIMITS.maxArgs).default([]),
  why: z.string().trim().max(200).default(''),
  folder: z.string().trim().max(120).optional(),
  venv: z.string().trim().max(120).optional(),
  allowScripts: z.boolean().optional()
}).strict()
export type RunStepInput = z.input<typeof runStepSchema>

/** What the server sends the Bridge for one step. `limitMs` is what is left of the plan's time. */
export const runJobInputSchema = runStepSchema.extend({ limitMs: z.number().int().min(5_000).max(RUN_LIMITS.installMs).optional() }).strict()

class Refuse extends Error {}
const no = (message: string): never => { throw new Refuse(message) }

const CONTROL = /[\x00-\x1f\x7f]/
const PATH_CHARS = /^[A-Za-z0-9_@.+, /-]+$/
const SCRIPT_ARG = /^[A-Za-z0-9_@.:=+,/ -]{1,200}$/
const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const NPM_SPEC = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[A-Za-z0-9._^~<>=*+-]{1,40})?$/
const PIP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PIP_VERSION = '(==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]+'
const PIP_SPEC = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]*(\\[[A-Za-z0-9,._-]+\\])?(${PIP_VERSION}(,${PIP_VERSION})*)?$`)
const SCRIPT_NAME = /^[A-Za-z0-9:_-]{1,60}$/
const GIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/

const list = (items: string[]) => (items.length <= 4 ? items.join(', ') : `${items.slice(0, 4).join(', ')} and ${items.length - 4} more`)

/** A folder or file name inside the chosen folder: relative, no "..", no drive letters, never starting with "-". */
export function relPath(value: string, what = 'path'): string {
  const v = value.trim()
  if (!v || v.length > 120 || !PATH_CHARS.test(v)) no(`"${value.slice(0, 60)}" is not a usable ${what}. Use a short name made of letters, numbers and . _ - / only.`)
  if (v.startsWith('/') || v.startsWith('-') || v.startsWith(' ') || v.endsWith(' ')) no(`The ${what} "${v}" must be inside the chosen folder and written without a leading / or -.`)
  if (v.split('/').some(p => p === '..')) no(`The ${what} "${v}" goes outside the chosen folder.`)
  return v.replace(/\/+/g, '/').replace(/^\.\//, '') || '.'
}

/** Files that hold passwords, keys or tokens. They are never listed, read or staged. */
export function isSecretFile(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.some(p => ['.ssh', '.aws', '.gnupg', '.kube'].includes(p.toLowerCase()))) return true
  const name = (parts[parts.length - 1] ?? '').toLowerCase()
  if (name === '.env' || (name.startsWith('.env.') && !/\.(example|sample|template|dist)$/.test(name))) return true
  if (/\.(pem|key|p12|pfx|keystore|jks|kdbx|ppk)$/.test(name)) return true
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) return true
  if (['.npmrc', '.pypirc', '.netrc', '.git-credentials', '.htpasswd'].includes(name)) return true
  if (/^(credentials|secrets?)(\.|$)/.test(name) || /^service-?account.*\.json$/.test(name)) return true
  return false
}

interface Spec { flags?: Record<string, 'bool' | 'int' | 'path' | 'word' | 'text'>, max?: number }
interface Parsed { flags: Array<[string, string | undefined]>, pos: string[], rest: string[] }

/**
 * Reads options and positional words against a list of what is allowed. `--` ends the options: what follows is
 * returned as `rest` (for a script's own arguments), and each word of it is still checked.
 */
function parse(args: string[], spec: Spec, allowRest = false): Parsed {
  const out: Parsed = { flags: [], pos: [], rest: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--') {
      if (!allowRest) no('The "--" separator is not allowed here.')
      out.rest = args.slice(i + 1)
      break
    }
    if (a.startsWith('-')) {
      const type = spec.flags?.[a]
      if (!type) no(`The option "${a.slice(0, 40)}" is not allowed.`)
      if (type === 'bool') { out.flags.push([a, undefined]); continue }
      const v = args[++i]
      if (v === undefined) no(`The option "${a}" needs a value.`)
      if (type === 'int' && !/^\d{1,4}$/.test(v!)) no(`The option "${a}" needs a number.`)
      if (type === 'path') relPath(v!)
      if (type === 'word' && !GIT_NAME.test(v!)) no(`"${v!.slice(0, 40)}" is not a usable name.`)
      if (type === 'text' && (CONTROL.test(v!) || v!.length < 1 || v!.startsWith('-'))) no(`The text after "${a}" is not usable.`)
      out.flags.push([a, v])
      continue
    }
    out.pos.push(a)
  }
  if (spec.max !== undefined && out.pos.length > spec.max) no(`Too many words after the command (at most ${spec.max}).`)
  for (const r of out.rest) if (!SCRIPT_ARG.test(r)) no(`"${r.slice(0, 40)}" cannot be passed to a script. Use plain words, numbers and . _ - / : = only.`)
  return out
}

const flagsOf = (p: Parsed) => p.flags.flatMap(([f, v]) => (v === undefined ? [f] : [f, v]))

type Draft = Omit<CheckedStep, 'program' | 'cwd' | 'venv' | 'timeoutMs' | 'env' | 'setupScripts'> & { env?: Record<string, string>, needsVenv?: boolean, scriptable?: boolean }

const draft = (d: Partial<Draft> & Pick<Draft, 'argv' | 'kind' | 'words'>): Draft => ({ runsCode: false, installs: false, network: false, ...d })

function scriptArgs(rest: string[]) { return rest.length ? ['--', ...rest] : [] }

// ---- npm, pnpm, yarn ----

const JS_INSTALL_FLAGS = { '--save-dev': 'bool', '-D': 'bool', '--save-exact': 'bool', '-E': 'bool', '--no-audit': 'bool', '--no-fund': 'bool', '--legacy-peer-deps': 'bool', '--omit=dev': 'bool', '--frozen-lockfile': 'bool', '--dev': 'bool' } as const

function packageManager(program: 'npm' | 'pnpm' | 'yarn', args: string[]): Draft {
  const sub = args[0]
  const rest = args.slice(1)
  if (sub === '--version' || sub === '-v') return draft({ argv: ['--version'], kind: 'read', words: `Check which version of ${program} is installed` })
  const add = (sub === 'install' || sub === 'i' || sub === 'add') && (program === 'npm' ? true : sub !== 'i')
  if (add) {
    const p = parse(rest, { flags: Object.fromEntries(Object.entries(JS_INSTALL_FLAGS).filter(([f]) => !(program === 'npm' && (f === '--frozen-lockfile' || f === '--dev')))) as Spec['flags'] })
    for (const s of p.pos) if (!NPM_SPEC.test(s)) no(`"${s.slice(0, 50)}" is not a package name from the package registry. Use a name like express or @scope/name, with an optional version (name@1.2.3).`)
    if (sub === 'add' && program !== 'npm' && !p.pos.length) no(`${program} add needs at least one package name.`)
    return draft({ argv: [program === 'npm' ? 'install' : sub!, ...flagsOf(p), ...p.pos], kind: 'install', installs: true, network: true,
      words: p.pos.length ? `Install ${list(p.pos)}` : 'Install what the project needs, from package.json', scriptable: true })
  }
  if (sub === 'ci' && program === 'npm') {
    const p = parse(rest, { flags: { '--no-audit': 'bool', '--no-fund': 'bool', '--legacy-peer-deps': 'bool', '--omit=dev': 'bool' }, max: 0 })
    return draft({ argv: ['ci', ...flagsOf(p)], kind: 'install', installs: true, network: true, words: 'Install exactly what the lock file lists', scriptable: true })
  }
  if (sub === 'uninstall' || sub === 'remove' || sub === 'rm') {
    const p = parse(rest, {})
    if (!p.pos.length) no('Say which package to remove.')
    for (const s of p.pos) if (!NPM_NAME.test(s)) no(`"${s.slice(0, 50)}" is not a package name.`)
    return draft({ argv: [program === 'npm' ? 'uninstall' : 'remove', ...p.pos], kind: 'setup', words: `Remove ${list(p.pos)} from the project` })
  }
  if (sub === 'run' || sub === 'run-script') {
    const p = parse(rest, {}, true)
    if (p.pos.length !== 1 || !SCRIPT_NAME.test(p.pos[0]!)) no(`Say which script to run, for example: ${program} run build.`)
    return draft({ argv: ['run', p.pos[0]!, ...scriptArgs(p.rest)], kind: 'run', runsCode: true, words: `Run the project's "${p.pos[0]}" script` })
  }
  if (sub === 'test' || sub === 't') {
    const p = parse(rest, {}, true)
    if (p.pos.length) no('Use "-- " before anything you pass to the tests.')
    return draft({ argv: ['test', ...scriptArgs(p.rest)], kind: 'run', runsCode: true, words: "Run the project's tests" })
  }
  if ((sub === 'ls' || sub === 'list') && program === 'npm') {
    const p = parse(rest, { flags: { '--depth=0': 'bool', '--depth=1': 'bool' }, max: 0 })
    return draft({ argv: ['ls', ...flagsOf(p)], kind: 'read', words: 'List the packages the project uses' })
  }
  if (sub === 'init' && program === 'npm') {
    if (rest.length !== 1 || rest[0] !== '-y') no('Use "npm init -y" so it does not stop to ask questions.')
    return draft({ argv: ['init', '-y'], kind: 'setup', words: 'Create a package.json for a new project' })
  }
  return no(`"${program} ${String(sub ?? '').slice(0, 30)}" is not allowed. ${program} can: install, add, remove, run, test${program === 'npm' ? ', ci, ls, init -y' : ''}.`)
}

// ---- pip ----

function pip(args: string[], lead: string[] = []): Draft {
  const sub = args[0]
  const rest = args.slice(1)
  if (sub === '--version') return draft({ argv: [...lead, '--version'], kind: 'read', words: 'Check which version of pip is installed' })
  if (sub === 'install') {
    const p = parse(rest, { flags: { '--upgrade': 'bool', '-U': 'bool', '--no-cache-dir': 'bool', '-q': 'bool', '--quiet': 'bool', '-r': 'path', '-e': 'path' } })
    for (const s of p.pos) if (!PIP_SPEC.test(s)) no(`"${s.slice(0, 50)}" is not a package from the package index. Use a name like requests, with an optional version (requests==2.32.0).`)
    const editable = p.flags.some(([f]) => f === '-e')
    const reqs = p.flags.filter(([f]) => f === '-r').map(([, v]) => v!)
    if (!p.pos.length && !editable && !reqs.length) no('Say what to install: package names, -r requirements.txt, or -e . for this project.')
    const what = [...p.pos, ...reqs.map(r => `what ${r} lists`), ...(editable ? ['this project'] : [])]
    return draft({ argv: [...lead, 'install', ...flagsOf(p), ...p.pos], kind: 'install', installs: true, network: true, runsCode: editable, needsVenv: true, scriptable: true, words: `Install ${list(what)}` })
  }
  if (sub === 'uninstall') {
    const p = parse(rest, { flags: { '-y': 'bool' } })
    if (!p.pos.length) no('Say which package to remove.')
    for (const s of p.pos) if (!PIP_NAME.test(s)) no(`"${s.slice(0, 50)}" is not a package name.`)
    return draft({ argv: [...lead, 'uninstall', '-y', ...p.pos], kind: 'setup', needsVenv: true, words: `Remove ${list(p.pos)} from the Python environment` })
  }
  if (sub === 'list' || sub === 'freeze') {
    parse(rest, {}); if (rest.length) no(`pip ${sub} takes nothing after it.`)
    return draft({ argv: [...lead, sub], kind: 'read', words: 'List the installed Python packages' })
  }
  if (sub === 'show') {
    const p = parse(rest, {})
    if (p.pos.length < 1 || p.pos.some(s => !PIP_NAME.test(s))) no('Say which package to show.')
    return draft({ argv: [...lead, 'show', ...p.pos], kind: 'read', words: `Show details of ${list(p.pos)}` })
  }
  return no(`"pip ${String(sub ?? '').slice(0, 30)}" is not allowed. pip can: install, uninstall, list, show, freeze.`)
}

// ---- python and node ----

function pythonOrNodeScript(program: 'python' | 'node', args: string[]): Draft {
  const script = relPath(args[0]!, 'script')
  const ok = program === 'node' ? /\.(c|m)?js$/i.test(script) : /\.py$/i.test(script)
  if (!ok) no(`${program} can run a ${program === 'node' ? '.js, .mjs or .cjs' : '.py'} file from the chosen folder. "${script.slice(0, 50)}" is not one.`)
  const extra = args.slice(1)
  for (const a of extra) if (!SCRIPT_ARG.test(a)) no(`"${a.slice(0, 40)}" cannot be passed to a script. Use plain words, numbers and . _ - / : = only.`)
  return draft({ argv: [script, ...extra], kind: 'run', runsCode: true, words: `Run the program ${script}` })
}

function node(args: string[]): Draft {
  if (!args.length) no('Say which file to run, for example: node app.js.')
  if (args[0] === '--version' || args[0] === '-v') return draft({ argv: ['--version'], kind: 'read', words: 'Check which version of Node is installed' })
  if (args[0]!.startsWith('-')) no(`The option "${args[0]!.slice(0, 40)}" is not allowed. Node can run a file: node app.js.`)
  return pythonOrNodeScript('node', args)
}

function python(args: string[]): Draft {
  if (!args.length) no('Say what to run, for example: python app.py, or python -m venv .venv.')
  const a0 = args[0]!
  if (a0 === '--version' || a0 === '-V') return draft({ argv: ['--version'], kind: 'read', words: 'Check which version of Python is installed' })
  if (a0 === '-m') {
    const mod = args[1]
    if (mod === 'venv') {
      if (args.length !== 3) no('Use: python -m venv .venv')
      return draft({ argv: ['-m', 'venv', relPath(args[2]!, 'folder')], kind: 'setup', words: `Create a Python environment in ${relPath(args[2]!, 'folder')}` })
    }
    if (mod === 'pip') return pip(args.slice(2), ['-m', 'pip'])
    if (mod === 'pytest') {
      const p = parse(args.slice(2), { flags: { '-q': 'bool', '-x': 'bool', '-v': 'bool', '-vv': 'bool', '--tb=short': 'bool', '--tb=line': 'bool', '-k': 'text' } })
      for (const s of p.pos) relPath(s, 'test file')
      return draft({ argv: ['-m', 'pytest', ...flagsOf(p), ...p.pos], kind: 'run', runsCode: true, words: "Run the project's Python tests" })
    }
    if (mod === 'unittest') {
      const p = parse(args.slice(2), { flags: { '-v': 'bool' } })
      if (p.pos.length !== 1 || p.pos[0] !== 'discover') no('Use: python -m unittest discover')
      return draft({ argv: ['-m', 'unittest', 'discover', ...flagsOf(p)], kind: 'run', runsCode: true, words: "Run the project's Python tests" })
    }
    return no(`"python -m ${String(mod ?? '').slice(0, 30)}" is not allowed. Allowed: venv, pip, pytest, unittest.`)
  }
  if (a0.startsWith('-')) no(`The option "${a0.slice(0, 40)}" is not allowed. Python can run a file (python app.py) or the modules venv, pip and pytest.`)
  return pythonOrNodeScript('python', args)
}

// ---- git ----

const GIT_HTTPS = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?\/[A-Za-z0-9._~/%-]+$/i

function git(args: string[]): Draft {
  const sub = args[0]
  const rest = args.slice(1)
  if (sub === '--version') return draft({ argv: ['--version'], kind: 'read', words: 'Check which version of git is installed' })
  if (sub === 'status') {
    const p = parse(rest, { flags: { '-s': 'bool', '--short': 'bool', '-b': 'bool', '--branch': 'bool', '--porcelain': 'bool' }, max: 0 })
    return draft({ argv: ['status', ...flagsOf(p)], kind: 'read', words: 'See what has changed in the project' })
  }
  if (sub === 'log') {
    const p = parse(rest, { flags: { '--oneline': 'bool', '--stat': 'bool', '-n': 'int' }, max: 0 })
    const hasN = p.flags.some(([f]) => f === '-n')
    return draft({ argv: ['log', '--no-color', '--no-ext-diff', ...(hasN ? [] : ['-n', '20']), ...flagsOf(p)], kind: 'read', words: 'Read the recent history of the project' })
  }
  if (sub === 'diff') {
    const p = parse(rest, { flags: { '--stat': 'bool', '--name-only': 'bool', '--cached': 'bool', '--staged': 'bool' } }, true)
    if (p.pos.length) no('Put file names after "--", for example: git diff -- app.js')
    for (const r of p.rest) { relPath(r, 'file'); if (isSecretFile(r)) no(`"${r}" holds secrets, so it is not shown.`) }
    return draft({ argv: ['diff', '--no-color', '--no-ext-diff', '--no-textconv', ...flagsOf(p), ...(p.rest.length ? ['--', ...p.rest] : [])], kind: 'read', words: 'See the changes made to the project' })
  }
  if (sub === 'init') {
    const p = parse(rest, { flags: { '-b': 'word' }, max: 0 })
    return draft({ argv: ['init', ...flagsOf(p)], kind: 'setup', words: 'Start tracking this folder with git' })
  }
  if (sub === 'add') {
    const p = parse(rest, { flags: { '-A': 'bool', '--all': 'bool' } })
    const all = p.flags.length > 0
    if (!all && !p.pos.length) no('Say which files to add, or use -A for everything.')
    for (const s of p.pos) { relPath(s, 'file'); if (isSecretFile(s)) no(`"${s}" holds secrets, so it is never added.`) }
    return draft({ argv: ['add', ...flagsOf(p), ...(p.pos.length ? ['--', ...p.pos] : [])], kind: 'save', words: all ? 'Get all the changes ready to save' : `Get ${list(p.pos)} ready to save` })
  }
  if (sub === 'commit') {
    const p = parse(rest, { flags: { '-m': 'text', '-a': 'bool' }, max: 0 })
    const msg = p.flags.find(([f]) => f === '-m')?.[1]
    if (!msg) no('A commit needs a message: git commit -m "what changed".')
    return draft({ argv: ['commit', '--no-verify', ...flagsOf(p)], kind: 'save', words: `Save a snapshot of the project: "${msg!.slice(0, 80)}"` })
  }
  if (sub === 'checkout' || sub === 'switch') {
    const create = sub === 'checkout' ? '-b' : '-c'
    if (rest.length !== 2 || rest[0] !== create || !GIT_NAME.test(rest[1]!) || rest[1]!.includes('..')) no(`Use: git ${sub} ${create} <new-branch-name>`)
    return draft({ argv: [sub, create, rest[1]!], kind: 'save', words: `Start a new branch called ${rest[1]}` })
  }
  if (sub === 'branch') {
    const p = parse(rest, { flags: { '--list': 'bool', '-a': 'bool' }, max: 0 })
    return draft({ argv: ['branch', ...flagsOf(p)], kind: 'read', words: 'List the branches' })
  }
  if (sub === 'clone') {
    const p = parse(rest, { flags: { '--depth': 'int' } })
    const url = p.pos[0]
    if (!url || p.pos.length > 2) no('Use: git clone https://github.com/owner/repo [folder]')
    if (!GIT_HTTPS.test(url!)) no('Only https:// addresses on a public website can be copied (no passwords in the address, no local or numeric addresses).')
    if (/^https:\/\/(localhost|[^/]*\.(local|internal|lan|home|corp))(:|\/)/i.test(url!)) no('Only addresses on the public internet can be copied.')
    const dir = p.pos[1] ? relPath(p.pos[1], 'folder') : null
    const host = url!.replace(/^https:\/\//, '').split('/')[0]
    return draft({ argv: ['clone', ...flagsOf(p), '--', url!, ...(dir ? [dir] : [])], kind: 'fetch', network: true, env: { GIT_ALLOW_PROTOCOL: 'https' }, words: `Copy a project from ${host} (${url!.replace(/^https:\/\/[^/]+\//, '').replace(/\.git$/, '')})` })
  }
  return no(`"git ${String(sub ?? '').slice(0, 30)}" is not allowed. git can: status, log, diff, init, add, commit, branch, checkout -b, clone. Sending changes out (push) is never allowed.`)
}

const NULL_FILE = '@null'

/**
 * Checks one step. `devNull` is the computer's empty file (so the Bridge can point config files at it).
 * On success, `argv` is exactly what to start the program with.
 */
export function checkStep(raw: unknown, opts: { devNull?: string } = {}): StepCheck {
  const devNull = opts.devNull ?? NULL_FILE
  try {
    const parsed = runStepSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || 'That step is not valid.' }
    const s = parsed.data
    for (const a of s.args) if (CONTROL.test(a)) no('An argument contains a control character.')
    const program = s.program
    let d: Draft
    if (program === 'npm' || program === 'pnpm' || program === 'yarn') d = packageManager(program, s.args)
    else if (program === 'pip' || program === 'pip3') d = pip(s.args)
    else if (program === 'node') d = node(s.args)
    else if (program === 'python' || program === 'python3') d = python(s.args)
    else d = git(s.args)

    const cwd = s.folder ? relPath(s.folder, 'folder') : ''
    const venv = s.venv ? relPath(s.venv, 'environment folder') : null
    const usesPython = program === 'pip' || program === 'pip3' || program === 'python' || program === 'python3'
    if (venv && !usesPython) no('Only Python steps can use an environment folder.')
    if (d.needsVenv && !venv) no('Python packages are installed into an environment inside the project, never into the computer itself. First create one with python -m venv .venv, then set the step\'s environment folder to .venv.')

    const scriptsOn = d.scriptable === true && s.allowScripts === true
    const argv = [...d.argv]
    const env: Record<string, string> = { ...(d.env ?? {}) }
    if (d.scriptable && !scriptsOn) {
      if (program === 'npm' || program === 'pnpm' || program === 'yarn') { argv.push('--ignore-scripts'); env.npm_config_ignore_scripts = 'true'; env.YARN_ENABLE_SCRIPTS = 'false' }
      else env.PIP_ONLY_BINARY = ':all:'
    }
    if (program === 'npm' || program === 'pnpm' || program === 'yarn') {
      Object.assign(env, { npm_config_userconfig: devNull, npm_config_global: 'false', npm_config_update_notifier: 'false', npm_config_fund: 'false', CI: '1' })
    } else if (usesPython) {
      Object.assign(env, { PIP_CONFIG_FILE: devNull, PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_REQUIRE_VIRTUALENV: '1', PYTHONDONTWRITEBYTECODE: '1' })
    } else if (program === 'git') {
      Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_EDITOR: 'true', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: devNull })
    }
    const words = d.words + (d.installs && !scriptsOn ? ' (package setup code off)' : '') + (scriptsOn ? ' (package setup code allowed)' : '')
    return { ok: true, step: { program, argv, cwd, venv, kind: d.kind, words, runsCode: d.runsCode || scriptsOn, installs: d.installs, network: d.network, setupScripts: scriptsOn, env, timeoutMs: d.kind === 'install' || d.kind === 'fetch' ? RUN_LIMITS.installMs : RUN_LIMITS.stepMs } }
  } catch (err: any) {
    if (err instanceof Refuse) return { ok: false, error: err.message }
    throw err
  }
}

/** A plan: why, and the steps in order. Every step is checked here, so a refused plan never reaches the person's approval card. */
export const runPlanSchema = z.object({
  why: z.string().trim().min(3).max(300),
  steps: z.array(runStepSchema).min(1).max(RUN_LIMITS.maxSteps),
  computer: z.string().max(60).optional()
}).superRefine((plan, ctx) => {
  plan.steps.forEach((s, i) => {
    const c = checkStep(s)
    if (!c.ok) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `Step ${i + 1}: ${c.error}` })
  })
})
export type RunPlanInput = z.input<typeof runPlanSchema>

/** The command as a person would type it. */
export const commandLine = (s: { program: string, args?: string[] }) => [s.program, ...(s.args ?? []).map(a => (/[\s"']/.test(a) ? JSON.stringify(a) : a))].join(' ')

// ---- What comes back: never secrets ----

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key hidden]'],
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}\b/g, '[key hidden]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[token hidden]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[key hidden]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[token hidden]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[key hidden]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[token hidden]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [hidden]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[hidden]@'],
  [/\b((?:[A-Z0-9_]*)(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|AUTH)[A-Z0-9_]*)\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi, '$1=[hidden]']
]

/** Hides what looks like a password, key or token. It is a safety net, not a promise: a program can print anything. */
export function redact(text: string): string {
  let out = text
  for (const [re, to] of SECRET_PATTERNS) out = out.replace(re, to)
  return out
}

/** The end of the output, cut at a line, with what was left out said plainly. */
export function tailOutput(text: string, max = RUN_LIMITS.maxOutputChars): { text: string, cut: boolean } {
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n?/g, '\n')
  if (clean.length <= max) return { text: clean.trimEnd(), cut: false }
  const tail = clean.slice(clean.length - max)
  const nl = tail.indexOf('\n')
  return { text: (nl >= 0 && nl < 400 ? tail.slice(nl + 1) : tail).trimEnd(), cut: true }
}

/** Environment variables a command may inherit. Everything else (tokens, keys, other apps' settings) is left out. */
export const INHERITED_ENV = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']

export function cleanEnv(base: Record<string, string | undefined>, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of INHERITED_ENV) if (typeof base[k] === 'string') out[k] = base[k]!
  return { ...out, ...extra }
}
