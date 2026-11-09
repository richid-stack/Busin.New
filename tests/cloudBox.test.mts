import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createRunnerServer } from '../runner/app'
import { runBoxPlan } from '../runner/plan'
import { CLOUD_LIMITS, boxResponseSchema, cloudPlanSchema } from '../shared/cloudBox'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const ac = () => new AbortController().signal
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const NOBODY = 65534

// ---- What the assistant may propose ----
const ok = (p: any) => cloudPlanSchema.safeParse(p)
const step = { program: 'node', args: ['a.js'] }
assert(ok({ why: 'Run a script', steps: [step], files: [{ path: 'a.js', content: 'console.log(1)' }] }).success, 'a plan with a script and the steps to run it is accepted')
assert(ok({ why: 'Run a script', steps: [step] }).success && (ok({ why: 'x y z', steps: [step] }) as any).data.files.length === 0, 'files are optional')
const push = ok({ why: 'Send it', steps: [step, { program: 'git', args: ['push'] }] })
assert(!push.success && /Step 2/.test(push.error!.issues[0]!.message), 'a step the rulebook refuses is named by number, before any card')
assert(!ok({ why: 'x y z', steps: [step], files: [{ path: '.env', content: 'A=1' }] }).success, 'a file that holds secrets is refused')
assert(!ok({ why: 'x y z', steps: [step], files: [{ path: '../a.js', content: '1' }] }).success && !ok({ why: 'x y z', steps: [step], files: [{ path: '/etc/a.js', content: '1' }] }).success, 'a file outside the folder is refused')
assert(!ok({ why: 'x y z', steps: [step], files: [{ path: '.git/config', content: '1' }] }).success, 'files inside .git are refused')
assert(!ok({ why: 'x y z', steps: [step], files: [{ path: 'a.js', content: '1' }, { path: 'A.js', content: '2' }] }).success, 'the same file twice is refused, whatever the capital letters')
assert(!ok({ why: 'x y z', steps: [step], files: Array.from({ length: CLOUD_LIMITS.maxFiles + 1 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' })) }).success, 'too many files is refused')
assert(!ok({ why: 'x y z', steps: [step], files: [{ path: 'big.txt', content: 'x'.repeat(CLOUD_LIMITS.maxFileChars + 1) }] }).success, 'a file that is too large is refused')
assert(!ok({ why: 'x y z', steps: [step], files: [1, 2, 3].map(i => ({ path: `f${i}.txt`, content: 'x'.repeat(CLOUD_LIMITS.maxFileChars) })) }).success, 'files that are too large together are refused')
assert(!ok({ why: 'x y z', steps: [step], files: [{ path: 'a.bin', content: 'a\0b' }] }).success, 'only plain text is written')

// ---- Running a plan for real ----
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'olb-box-')))
if (isRoot) fs.chmodSync(work, 0o755)
const deps = { workRoot: work, ...(isRoot ? { uid: NOBODY, gid: NOBODY } : {}) }
const files = [
  { path: 'hello.js', content: "console.log('hello from the box'); console.log(require('fs').readdirSync('.').sort().join(','))" },
  { path: 'src/deep/util.txt', content: 'x' },
  { path: 'fail.js', content: "console.error('Error: nope'); process.exit(3)" },
  { path: 'later.js', content: "console.log('should not run')" }
]
const good = await runBoxPlan({ steps: [{ program: 'node', args: ['hello.js'] }, { program: 'node', args: ['--version'] }], files }, ac(), deps)
assert(!good.error && good.steps.length === 2 && good.steps.every(s => s.exitCode === 0) && /hello from the box/.test(good.steps[0]!.output), 'the files are written and the steps run in order')
assert(/fail\.js,hello\.js,later\.js,src/.test(good.steps[0]!.output), 'the program sees exactly the files that were written, in folders too')
assert(boxResponseSchema.safeParse(good).success, 'the answer fits its own rules')
assert(fs.readdirSync(work).length === 0, 'the throw-away folder is deleted afterwards')

const bad = await runBoxPlan({ steps: [{ program: 'node', args: ['fail.js'] }, { program: 'node', args: ['later.js'] }], files }, ac(), deps)
assert(bad.steps.length === 1 && bad.steps[0]!.exitCode === 3 && /nope/.test(bad.steps[0]!.output) && !JSON.stringify(bad).includes('should not run'), 'it stops at the first step that fails, and the next never starts')

const missing = await runBoxPlan({ steps: [{ program: 'node', args: ['nothere.js'] }], files: [] }, ac(), deps)
assert(missing.steps.length === 1 && missing.steps[0]!.exitCode === null && /nothere\.js/.test(missing.steps[0]!.error ?? ''), 'a step that cannot start says why')

const refused = await runBoxPlan({ steps: [{ program: 'git', args: ['push'] }], files: [] }, ac(), deps)
assert(refused.steps.length === 0 && /push/.test(refused.error ?? ''), 'the worker applies the rulebook again: a refused step never runs')
assert((await runBoxPlan({ steps: [], files: [] }, ac(), deps)).error !== undefined && (await runBoxPlan('nonsense', ac(), deps)).error !== undefined, 'a plan that cannot be read is refused')
assert(((await runBoxPlan({ steps: [{ program: 'node', args: ['a.js'] }], files: [{ path: '.env', content: 'A=1' }] }, ac(), deps)).error ?? '') !== '', 'a secret file is refused here too')

// Two people, one after another: the second sees nothing of the first.
await runBoxPlan({ steps: [{ program: 'node', args: ['w.js'] }], files: [{ path: 'w.js', content: "require('fs').writeFileSync('left-behind.txt','x'); require('fs').writeFileSync(require('os').homedir()+'/h.txt','x')" }] }, ac(), deps)
const next = await runBoxPlan({ steps: [{ program: 'node', args: ['r.js'] }], files: [{ path: 'r.js', content: "const fs=require('fs');console.log(JSON.stringify({here:fs.readdirSync('.'),home:fs.readdirSync(require('os').homedir())}))" }] }, ac(), deps)
const seen = JSON.parse(next.steps[0]!.output.trim().split('\n').pop()!)
assert(seen.here.join() === 'r.js' && seen.home.length === 0, 'nothing a plan leaves behind is there for the next one')

// What the program can see of the worker.
process.env.RUNNER_SECRET_FOR_TEST = 'this-must-never-reach-a-program-0123456789'
const spy = await runBoxPlan({ steps: [{ program: 'node', args: ['spy.js'] }], files: [{ path: 'spy.js', content: `
const fs=require('fs'); const o={env:Object.keys(process.env).sort(), home:process.env.HOME, uid:process.getuid()}
try { o.parent=fs.readFileSync('/proc/'+process.ppid+'/environ','utf8').includes('RUNNER_SECRET_FOR_TEST') ? 'READ' : 'empty' } catch (e) { o.parent='denied' }
console.log(JSON.stringify(o))` }] }, ac(), deps)
const sp = JSON.parse(spy.steps[0]!.output.trim().split('\n').pop()!)
assert(!sp.env.includes('RUNNER_SECRET_FOR_TEST') && !JSON.stringify(spy).includes('this-must-never'), 'the worker\'s own secret is not in the program\'s environment')
assert(sp.home.startsWith(work) || sp.home.includes('box-'), 'the home folder is inside the throw-away folder')
if (isRoot) {
  assert(sp.uid === NOBODY, 'programs run as an ordinary user, not root')
  assert(sp.parent === 'denied', 'a program cannot read the worker\'s process to find its secret')
} else console.log('SKIP not started as root: the user switch is checked only when the tests run as root')
delete process.env.RUNNER_SECRET_FOR_TEST

// Time and stopping.
fs.writeFileSync(path.join(work, 'noop'), '')
const slowFiles = [{ path: 'slow.js', content: 'setTimeout(() => {}, 60000)' }]
const slow = await runBoxPlan({ steps: [{ program: 'node', args: ['slow.js'] }], files: slowFiles, limitMs: 10_000 }, ac(), deps)
assert(slow.steps[0]!.timedOut === true, 'a step that runs out of time is stopped and reported')
const stopper = new AbortController()
setTimeout(() => stopper.abort(), 600)
const t0 = Date.now()
const cut = await runBoxPlan({ steps: [{ program: 'node', args: ['slow.js'] }], files: slowFiles }, stopper.signal, deps)
assert(Date.now() - t0 < 8000 && cut.steps[0]?.exitCode === null && /Stopped/.test(cut.steps[0]?.error ?? ''), 'hanging up stops the programs')
fs.rmSync(path.join(work, 'noop'))

// ---- The web face ----
const SECRET = 'a-long-shared-secret-for-the-test-0123456789'
let restarts = 0
const app = createRunnerServer({ secret: SECRET, box: deps, afterPlan: () => { restarts++ }, maxBodyChars: 5000 })
await new Promise<void>(r => app.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
const post = (body: unknown, auth: string | null = SECRET, url = '/run') => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })
assert((await fetch(base + '/health')).status === 200, 'health needs no secret')
assert((await post({}, null)).status === 401 && (await post({}, 'wrong-secret-wrong-secret-0123456789')).status === 401, 'no secret, or the wrong one, is turned away')
assert((await post({}, SECRET, '/other')).status === 404 && (await fetch(base + '/run')).status === 404, 'nothing else is served')
assert((await post('{not json')).status === 400, 'unreadable input is a plain error')
assert((await post('x'.repeat(6000))).status === 413, 'an oversized request is refused')
const before = restarts
const r1 = await post({ steps: [{ program: 'node', args: ['hello.js'] }], files: [files[0]] })
const b1: any = await r1.json()
assert(r1.status === 200 && boxResponseSchema.safeParse(b1).success && /hello from the box/.test(b1.steps[0].output), 'a plan is run over the wire with the right secret')
await new Promise(r => setTimeout(r, 50))
assert(restarts === before + 1, 'a clean instance is asked for after the plan, once')
// One at a time.
const longRun = post({ steps: [{ program: 'node', args: ['slow.js'] }], files: slowFiles, limitMs: 10_000 })
await new Promise(r => setTimeout(r, 400))
assert((await post({ steps: [{ program: 'node', args: ['--version'] }] })).status === 429, 'a second plan while one is running is told to wait')
await longRun
const r3 = await post({ steps: [{ program: 'node', args: ['--version'] }] })
assert(r3.status === 200, 'and the next one works once the first has finished')
app.close()
assert((() => { try { createRunnerServer({ secret: 'short' }); return false } catch { return true } })(), 'the worker refuses to start with a weak secret')

fs.rmSync(work, { recursive: true, force: true })
