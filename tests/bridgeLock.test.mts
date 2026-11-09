import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LOCK_STALE_MS, takeLock } from '../bridge/lock'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'olb-lock-'))
const tries = (fn: () => unknown) => { try { fn(); return null } catch (e) { return e as Error } }

// A free lock is taken, and given back.
{
  const dir = tmp()
  const give = takeLock(dir, { pid: 111 })
  assert(fs.readFileSync(path.join(dir, 'run.lock'), 'utf8') === '111', 'a free lock is taken')
  assert(/already running/.test(tries(() => takeLock(dir, { pid: 222, isAlive: () => true }))?.message ?? ''), 'a second Bridge is refused while the first is alive and heard from')
  give()
  assert(!fs.existsSync(path.join(dir, 'run.lock')), 'the lock is given back')
  takeLock(dir, { pid: 222 })()
  fs.rmSync(dir, { recursive: true, force: true })
}

// Two Bridges starting at the same moment: exactly one gets the lock.
{
  const dir = tmp()
  const results = [1, 2, 3, 4, 5].map(pid => tries(() => takeLock(dir, { pid, isAlive: () => true })))
  assert(results.filter(r => r === null).length === 1, 'of several that start together, only one gets the lock')
  fs.rmSync(dir, { recursive: true, force: true })
}

// A lock left by a Bridge that was killed does not keep the computer offline.
{
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'run.lock'), '999')
  assert(tries(() => takeLock(dir, { pid: 5, isAlive: () => false })) === null, 'a lock whose owner is gone is replaced')
  fs.rmSync(dir, { recursive: true, force: true })

  // The number was reused by some other program: it is alive, but the Bridge's heartbeat (state.json) is old.
  const d2 = tmp()
  fs.writeFileSync(path.join(d2, 'run.lock'), '999')
  fs.writeFileSync(path.join(d2, 'state.json'), '{}')
  const old = new Date(Date.now() - 5 * 60_000)
  fs.utimesSync(path.join(d2, 'run.lock'), old, old); fs.utimesSync(path.join(d2, 'state.json'), old, old)
  assert(tries(() => takeLock(d2, { pid: 5, isAlive: () => true })) === null, 'a lock whose number was reused by another program is replaced, because the Bridge stopped writing its heartbeat')
  fs.rmSync(d2, { recursive: true, force: true })

  // A live Bridge keeps writing its state, so its lock stays valid even when the lock file itself is old.
  const d3 = tmp()
  fs.writeFileSync(path.join(d3, 'run.lock'), '999')
  fs.writeFileSync(path.join(d3, 'state.json'), '{}')
  fs.utimesSync(path.join(d3, 'run.lock'), old, old)
  assert(/already running/.test(tries(() => takeLock(d3, { pid: 5, isAlive: () => true }))?.message ?? ''), 'a Bridge that is writing its heartbeat keeps its lock')
  assert(LOCK_STALE_MS === 20_000, 'the heartbeat window matches the tray icon (20 seconds)')
  fs.rmSync(d3, { recursive: true, force: true })
}

// ---- The installer and the build, read as text ----
const iss = fs.readFileSync('bridge/installer/openlobs-bridge.iss', 'utf8')
const cmdIcons = iss.split('\n').filter(l => /Filename: "\{cmd\}"/.test(l))
assert(cmdIcons.length >= 10 && cmdIcons.every(l => /Parameters: "\/[kc] """"\{app\}\\bridge\.cmd"" [^"]*"""\s*$/.test(l)), 'every Start-menu command has its whole command in quotes, so a folder with a space works')
assert(!/taskkill[^\n]*\/IM/i.test(iss) && /StartsWith\(/.test(iss), 'only the Bridge run from this installation is stopped, not any program with the same name')
const prepare = iss.slice(iss.indexOf('function PrepareToInstall'), iss.indexOf('procedure CurStepChanged'))
assert(/ConnectProblem/.test(prepare) && prepare.indexOf('ConnectProblem') < prepare.indexOf('StopRunningBridge'), 'a silent install is checked for unsafe text before anything runs')
assert(/RunBridge\('disconnect'/.test(iss), 'installing again with a new code removes the earlier computer from OpenLobs')
const wf = fs.readFileSync('.github/workflows/bridge-windows.yml', 'utf8')
assert(!/run: \|[^]*\$\{\{\s*github\.event\.inputs/.test(wf.replace(/env:[^]*?run:/g, 'run:')) && /DEFAULT_SERVER: \$\{\{ github\.event\.inputs\.default_server \}\}/.test(wf), 'the build input is passed as data, not pasted into the script')
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
assert(/github\.event\.pull_request\.number \|\| github\.sha/.test(ci), 'every push to main has its own group, so a queued build is never cancelled')
const cli = fs.readFileSync('bridge/cli.ts', 'utf8')
assert(!/allow: load\(\)\?\.allow/.test(cli) && /load\(\)\?\.token === config\.token/.test(cli), 'a new pairing starts with nothing allowed, and a Bridge that was disconnected removes only its own connection')
