import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkRunFolder, folderLook, folderRead, runCommand, which } from '../bridge/run'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (p: Promise<unknown>) => { try { await p; return null } catch (e: any) { return String(e.message) } }

// Real programs, started for real, in a real throwaway folder. Only the Bridge's own rules are under test.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'olb-run-')))
const root = path.join(tmp, 'project')
fs.mkdirSync(root)
const home = path.join(tmp, 'home')
fs.mkdirSync(home)
fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = Test\n\temail = test@example.com\n')
const baseEnv = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', NPM_TOKEN: 'npm_secret', AWS_SECRET_ACCESS_KEY: 'aws_secret', OPENAI_API_KEY: 'sk-test-abcdefghijklmnop123456' } as NodeJS.ProcessEnv
const deps = { env: baseEnv }
const never = new AbortController().signal
const write = (name: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text) }
const run = (program: string, args: string[], extra: Record<string, unknown> = {}, signal: AbortSignal = never) => runCommand(root, { program, args, ...extra }, signal, deps)

// ---- Starting a program ----
write('hello.js', "console.log('hello from', process.cwd().split(/[\\\\/]/).pop()); console.error('a warning')")
const hello = await run('node', ['hello.js'])
assert(hello.exitCode === 0 && /hello from project/.test(hello.output) && /a warning/.test(hello.output) && !hello.timedOut && hello.ms >= 0, 'a program runs inside the chosen folder, and its output (both streams) comes back')
write('sub/where.js', "console.log('in', process.cwd().split(/[\\\\/]/).pop())")
assert(/in sub/.test((await run('node', ['where.js'], { folder: 'sub' })).output), 'a step can work in a folder inside the chosen folder')
write('fail.js', "console.log('before'); console.error('Error: it broke'); process.exit(3)")
const failed = await run('node', ['fail.js'])
assert(failed.exitCode === 3 && /it broke/.test(failed.output), 'a failing program is a normal answer with its exit code and error, not a crash')

// ---- A clean environment, and nothing secret in what comes back ----
write('env.js', "console.log(JSON.stringify(Object.keys(process.env).sort())); console.log('token is', process.env.GITHUB_TOKEN)")
const envOut = await run('node', ['env.js'])
assert(!/GITHUB_TOKEN|NPM_TOKEN|AWS_SECRET|OPENAI_API_KEY/.test(envOut.output) && /"PATH"/.test(envOut.output) && /token is undefined/.test(envOut.output), 'the program does not inherit tokens or keys')
write('leak.js', "console.log('key', 'sk-proj-abcdefghijklmnop1234567890'); console.log('DB_PASSWORD=hunter2'); console.log('ok line')")
const leak = await run('node', ['leak.js'])
assert(!/sk-proj|hunter2/.test(leak.output) && /ok line/.test(leak.output), 'what looks like a key or password is hidden in the output')

// ---- Output size ----
write('flood.js', "for (let i = 0; i < 30000; i++) console.log('line number ' + i); console.log('THE END')")
const flood = await run('node', ['flood.js'])
assert(flood.output.length <= 6000 && flood.outputTruncated && /THE END$/.test(flood.output), 'long output keeps the end and says it was cut')

// ---- Time, stopping, and the programs it started ----
write('child.js', `const { spawn } = require('node:child_process'); const fs = require('node:fs')
const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
fs.writeFileSync('child.pid', String(c.pid)); console.log('started'); setInterval(() => {}, 1000)`)
const alive = (pid: number) => {
  try { process.kill(pid, 0) } catch { return false }
  // A program that has ended but has not been collected yet (common in containers) is not running any more.
  try { return !/^\d+ \(.*\) [ZX]/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')) } catch { return true }
}
const t0 = Date.now()
const timed = await run('node', ['child.js'], { limitMs: 5000 })
const childPid = Number(fs.readFileSync(path.join(root, 'child.pid'), 'utf8'))
await new Promise(r => setTimeout(r, 400))
assert(timed.timedOut && Date.now() - t0 < 9000 && /started/.test(timed.output), 'a program that runs too long is stopped, and the result says so')
assert(childPid > 0 && !alive(childPid), 'and so is everything it started')
const ac = new AbortController()
setTimeout(() => ac.abort(), 600)
const t1 = Date.now()
const stopped = await rejects(run('node', ['child.js'], {}, ac.signal))
const childPid2 = Number(fs.readFileSync(path.join(root, 'child.pid'), 'utf8'))
await new Promise(r => setTimeout(r, 400))
assert(stopped === 'Stopped.' && Date.now() - t1 < 4000 && !alive(childPid2), 'the stop button ends the program and everything it started, quickly')
assert(await rejects(run('node', ['hello.js'], {}, (() => { const a = new AbortController(); a.abort(); return a.signal })())) === 'Stopped.', 'a stop that arrived first prevents the program from running to the end')

// ---- One at a time ----
write('slow.js', "const fs = require('node:fs'); fs.appendFileSync('order.log', 'start ' + process.argv[2] + '\\n'); setTimeout(() => { fs.appendFileSync('order.log', 'end ' + process.argv[2] + '\\n') }, 300)")
await Promise.all([run('node', ['slow.js', 'a']), run('node', ['slow.js', 'b'])])
assert(fs.readFileSync(path.join(root, 'order.log'), 'utf8').trim().split('\n').join(',') === 'start a,end a,start b,end b', 'two commands never overlap')

// ---- The folder is the limit for what OpenLobs names ----
assert((await rejects(run('node', ['../outside.js'])) ?? '').includes('outside'), 'a path that leaves the folder is refused')
fs.writeFileSync(path.join(tmp, 'outside.js'), "console.log('escaped')")
let linked = true
try { fs.symlinkSync(path.join(tmp, 'outside.js'), path.join(root, 'link.js')) } catch { linked = false }
if (linked) assert((await rejects(run('node', ['link.js'])) ?? '').includes('outside the chosen folder'), 'a shortcut that leads outside the folder is refused')
assert((await rejects(run('node', ['-e', 'console.log(1)'])) ?? '').includes('not allowed'), 'the Bridge applies the rulebook itself, whatever the server sent')
assert((await rejects(runCommand(root, { program: 'git', args: ['push'] }, never, deps)) ?? '').includes('push'), 'git push is refused here too')
assert((await rejects(runCommand(root, { program: 'node', args: ['hello.js'], extra: 1 }, never, deps))) !== null, 'unknown fields are refused')
assert((await rejects(runCommand(null, { program: 'node', args: ['hello.js'] }, never, deps)) ?? '').includes('bridge allow run'), 'with no folder chosen, it says how to choose one')
assert((await rejects(runCommand(path.join(tmp, 'gone'), { program: 'node', args: ['hello.js'] }, never, deps)) ?? '').includes('does not exist'), 'a folder that is gone is reported')
assert((await rejects(runCommand(root, { program: 'python3', args: ['x.py'] }, never, { env: { PATH: '' } })) ?? '').includes('Could not find python3'), 'a missing program is reported in plain words')

// ---- git stays inside the folder ----
const gitOk = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()
if (gitOk) {
  const g = await run('git', ['init', '-b', 'main'])
  assert(g.exitCode === 0, 'git init works')
  write('a.txt', 'one')
  write('.env', 'SECRET=1')
  assert((await rejects(run('git', ['add', '.env'])) ?? '').includes('secrets'), 'a secret file is never added')
  fs.mkdirSync(path.join(root, 'keys'), { recursive: true }); write('keys/server.pem', 'KEY'); write('Credentials.JSON', '{}')
  await run('git', ['add', '-A'])
  const c = await run('git', ['commit', '-m', 'First snapshot'])
  assert(c.exitCode === 0 && /First snapshot/.test(c.output), 'git can save a snapshot')
  const left = (await run('git', ['status', '-s'])).output
  assert(/\?\? \.env/.test(left) && /\?\? keys\//.test(left) && /\?\? Credentials\.JSON/.test(left) && !/a\.txt/.test(left), 'add everything stages the work but leaves secret files out of the snapshot, whatever their case')
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho HOOK RAN >&2\nexit 1\n', { mode: 0o755 })
  write('b.txt', 'two')
  await run('git', ['add', 'b.txt'])
  const hooked = await run('git', ['commit', '-m', 'Second'])
  assert(hooked.exitCode === 0 && !/HOOK RAN/.test(hooked.output), 'a project\'s own git hooks do not run')
  const log = await run('git', ['log', '--oneline'])
  assert(/Second/.test(log.output) && /First snapshot/.test(log.output), 'git log reads the history')
  // A project one level up must never be found.
  const outer = path.join(tmp, 'outer')
  fs.mkdirSync(path.join(outer, 'inner'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: outer })
  const inside = await runCommand(path.join(outer, 'inner'), { program: 'git', args: ['status'] }, never, deps)
  assert(inside.exitCode !== 0 && /not a git repository/i.test(inside.output), 'git does not climb out of the chosen folder to change a project above it')
} else console.log('SKIP git is not installed here')

// ---- npm, and Python environments ----
const npmOk = which('npm', baseEnv, process.platform) !== null
if (npmOk) {
  const ver = await run('npm', ['--version'])
  assert(ver.exitCode === 0 && /^\d+\.\d+\.\d+/.test(ver.output), 'npm runs')
  fs.writeFileSync(path.join(home, '.npmrc'), '//registry.npmjs.org/:_authToken=npm_VERY_SECRET_TOKEN_123\n')
  assert((await run('npm', ['init', '-y'])).exitCode === 0 && fs.existsSync(path.join(root, 'package.json')), 'npm init -y makes a package.json')
  const ins = await run('npm', ['install'])
  assert(ins.exitCode === 0 && !/VERY_SECRET/.test(ins.output), 'npm install with nothing to add works, and does not read the person\'s npm login file')
  write('package.json', JSON.stringify({ name: 'x', version: '1.0.0', scripts: { build: "node -e \"console.log('built ok')\"", test: "node -e \"console.log('tests ok')\"" } }))
  assert(/built ok/.test((await run('npm', ['run', 'build'])).output) && /tests ok/.test((await run('npm', ['test'])).output), 'npm run and npm test run the project\'s scripts')
} else console.log('SKIP npm is not installed here')

const pyOk = which('python3', baseEnv, process.platform) !== null
if (pyOk) {
  assert((await rejects(run('pip', ['list'], { venv: '.venv' })) ?? '').includes('not a Python environment'), 'an environment that does not exist yet is reported, with the fix')
  const mk = await run('python3', ['-m', 'venv', '.venv'])
  assert(mk.exitCode === 0 && fs.existsSync(path.join(root, '.venv', 'pyvenv.cfg')), 'python can create an environment inside the project')
  const lst = await run('python3', ['-m', 'pip', 'list'], { venv: '.venv' })
  assert(lst.exitCode === 0 && /pip/i.test(lst.output), 'pip lists what is installed in that environment')
  write('who.py', "import sys; print('prefix', sys.prefix.split('/')[-1])")
  assert(/prefix \.venv/.test((await run('python3', ['who.py'], { venv: '.venv' })).output), 'a script runs with the environment\'s own Python')
  const noVenvInstall = await rejects(run('pip', ['install', 'requests']))
  assert((noVenvInstall ?? '').includes('environment'), 'installing without an environment is refused')
} else console.log('SKIP python3 is not installed here')

// ---- Looking in the folder ----
write('src/app.js', 'console.log(1)')
write('src/deep/more/hidden.js', 'x')
write('node_modules/pkg/index.js', 'x')
write('.env.production', 'SECRET=1')
write('keys/server.pem', 'x')
write('notes.md', 'hello')
const look = folderLook(root, {})
const names = look.entries.map(e => e.name)
assert(names.includes('src/') && names.includes('src/app.js') && names.includes('notes.md') && names.includes('node_modules/') && !names.some(n => n.startsWith('node_modules/pkg')), 'the folder is listed, and package folders are named but not opened')
assert(!names.some(n => /\.env|\.pem/.test(n)) && look.hidden >= 2, 'secret files are never listed (only counted)')
assert(!names.includes('src/deep/more/hidden.js') && names.includes('src/deep/'), 'two levels deep, no more')
assert(!names.includes('link.js') || !linked, 'shortcuts are not listed')
assert(folderLook(root, { path: 'src', depth: 1 }).entries.every(e => e.name.startsWith('src/')), 'a sub-folder can be listed')
assert(await rejects(Promise.resolve().then(() => folderLook(root, { path: '../' }))) !== null, 'listing outside the folder is refused')

write('read.txt', 'plain text\napi_key = "abc123secret"\nend')
const rd = folderRead(root, { file: 'read.txt' })
assert(rd.name === 'read.txt' && /plain text/.test(rd.text) && !/abc123secret/.test(rd.text) && !rd.truncated, 'a text file is read, with anything key-like hidden')
for (const f of ['.env', '.env.production', 'keys/server.pem']) assert((await rejects(Promise.resolve().then(() => folderRead(root, { file: f })))) !== null, `reading ${f} is refused`)
fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3, 4]))
assert((await rejects(Promise.resolve().then(() => folderRead(root, { file: 'bin.dat' }))) ?? '').includes('binary'), 'a binary file is not read')
write('big.txt', 'x'.repeat(50_000))
assert(folderRead(root, { file: 'big.txt' }).text.length === 12_000 && folderRead(root, { file: 'big.txt' }).truncated, 'a long file is cut, and says so')
if (linked) { fs.symlinkSync(path.join(tmp, 'outside.js'), path.join(root, 'peek.txt')); assert((await rejects(Promise.resolve().then(() => folderRead(root, { file: 'peek.txt' })))) !== null, 'a shortcut to a file outside the folder is not followed') }
assert((await rejects(Promise.resolve().then(() => folderRead(root, { file: '../outside.js' })))) !== null, 'reading outside the folder is refused')

// ---- Which folder may be chosen ----
for (const bad of ['/', '/etc', '/usr/local', os.homedir(), '/home', 'C:\\', 'C:\\Windows\\System32', 'C:\\Program Files\\App', 'C:\\Users']) assert(((): boolean => { try { checkRunFolder(bad); return false } catch (e: any) { return /too broad/.test(e.message) } })(), `a folder that is too broad is refused: ${bad}`)
for (const good of [root, path.join(os.homedir(), 'Documents', 'OpenLobs projects'), 'C:\\Users\\Richie\\Projects\\site']) assert(checkRunFolder(good) === good, `a project folder is accepted: ${good}`)

fs.rmSync(tmp, { recursive: true, force: true })

// ---- a Windows crash code is accepted ----
{
  const { runCommandResult } = await import('../server/services/bridge/model')
  assert(runCommandResult.safeParse({ exitCode: 3221225477, timedOut: false, ms: 5, output: 'crashed', outputTruncated: false }).success && runCommandResult.safeParse({ exitCode: -1, timedOut: true, ms: 5, output: '', outputTruncated: false }).success, 'a program that crashed on Windows still reports its output')
  assert(!runCommandResult.safeParse({ exitCode: 2 ** 33, timedOut: false, ms: 5, output: '', outputTruncated: false }).success, 'but a nonsense exit code is refused')
}
