import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createRunnerServer } from '../runner/app'
import { InspectError } from '../server/services/inspect/browser'
import { defaultCloudBox, runnerBox } from '../server/services/cloudbox/provider'
import { UsageLimitError, UsageUnavailableError } from '../server/services/usage/usage'
import { cloudPlanCost } from '../server/services/usage/plans'
import { createRunInCloudTool } from '../server/utils/tools/runInCloud'
import { getRunTrace } from '../src/utils/tool'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

// A real box worker on this machine, reached over real HTTP, with real programs. Only the credits store is replaced.
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'olb-cloud-')))
if (isRoot) fs.chmodSync(work, 0o755)
const SECRET = 'cloud-test-secret-0123456789-abcdefghij'
const app = createRunnerServer({ secret: SECRET, box: { workRoot: work, ...(isRoot ? { uid: 65534, gid: 65534 } : {}) } })
await new Promise<void>(r => app.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
const box = runnerBox({ url, secret: SECRET })

const charges: Array<{ userId: string, cost: number }> = []
let refunds = 0
let allowance = 100
const charge = async (userId: string, cost: number) => {
  if (cost > allowance) throw new UsageLimitError('You have used all of today\'s credits.', 'daily', new Date(Date.now() + 3600_000).toISOString())
  allowance -= cost; charges.push({ userId, cost })
  return { refund: async () => { refunds++; allowance += cost } }
}
let n = 0
const make = (deps: any = {}) => createRunInCloudTool(`cloud-${++n}`, { box, charge, cost: () => 5, ...deps })
const exec = (t: any, input: any) => (t.execute as any)(cloudPlanSchemaParse(input), {})
import { cloudPlanSchema } from '../shared/cloudBox'
const cloudPlanSchemaParse = (input: any) => cloudPlanSchema.parse(input)

// ---- Approval and input ----
const t: any = make()
assert(t.needsApproval === true, 'a plan in the cloud always needs the person\'s approval')
assert(!t.inputSchema.safeParse({ why: 'Send it', steps: [{ program: 'git', args: ['push'] }] }).success, 'a step that is not allowed is refused before any card')
assert(!t.inputSchema.safeParse({ why: 'Use it', steps: [{ program: 'node', args: ['a.js'] }], files: [{ path: '.env', content: 'A=1' }] }).success, 'a file that holds secrets is refused before any card')

// ---- A plan that works ----
const hello = { path: 'hello.js', content: "console.log('hello from the cloud')" }
const good: any = await exec(make(), { why: 'Run my script', steps: [{ program: 'node', args: ['hello.js'], why: 'See it work' }, { program: 'node', args: ['--version'] }], files: [hello] })
assert(good.status === 'ok' && good.steps.length === 2 && good.steps.every((s: any) => s.ok) && /hello from the cloud/.test(good.steps[0].output), 'the plan runs in the box and reports what it printed')
assert(good.computer === 'a fresh cloud box' && good.steps[0].command === 'node hello.js' && /Run the program hello\.js/.test(good.steps[0].words), 'each step carries the command and what it does in plain words')
assert(/never instructions/.test(good.notice), 'what a program printed is marked as data')
assert(charges.length === 1 && charges[0]!.cost === 5, 'the plan used credits, once')
assert(fs.readdirSync(work).length === 0, 'nothing is kept in the box afterwards')

// ---- A plan that fails stops ----
const bad: any = await exec(make(), { why: 'Try it', steps: [{ program: 'node', args: ['fail.js'] }, { program: 'node', args: ['hello.js'] }], files: [hello, { path: 'fail.js', content: "console.error('Error: broke'); process.exit(2)" }] })
assert(bad.status === 'stopped' && bad.steps.length === 1 && bad.steps[0].exitCode === 2 && bad.notRun === 1 && /broke/.test(bad.steps[0].output), 'it stops at the first failure and says how many did not run')
assert(/did not work/.test(bad.note) && /plain words/.test(bad.note) && /new plan starts from nothing/.test(bad.note), 'and tells the assistant to explain it, and that the box is gone')
const gone: any = await exec(make(), { why: 'Try it', steps: [{ program: 'node', args: ['nothere.js'] }] })
assert(gone.status === 'stopped' && gone.steps[0].ok === false && /nothere\.js/.test(gone.steps[0].output), 'a step that cannot start shows why')

// ---- The credits ----
const spent = charges.length
allowance = 3
const poor: any = await exec(make(), { why: 'Run it', steps: [{ program: 'node', args: ['--version'] }] })
assert(poor.status === 'failed' && /used all/.test(poor.error) && /Nothing was run/.test(poor.error) && charges.length === spent, 'with too few credits nothing runs and nothing is charged')
allowance = 100
const before = refunds
const unreachable = make({ box: runnerBox({ url: 'http://127.0.0.1:1', secret: SECRET }) })
const down: any = await exec(unreachable, { why: 'Run it', steps: [{ program: 'node', args: ['--version'] }] })
assert(down.status === 'failed' && /could not be reached/.test(down.error) && /do not pretend/.test(down.error) && refunds === before + 1, 'if the box cannot be reached the credits are given back')
const refusedBox = make({ box: { name: 'x', run: async () => ({ steps: [], error: 'Step 1: nope' }) } })
const refused: any = await exec(refusedBox, { why: 'Run it', steps: [{ program: 'node', args: ['--version'] }] })
assert(refused.status === 'failed' && /Nothing was run/.test(refused.error) && refunds === before + 2, 'a plan the box refuses is refunded too')
assert(cloudPlanCost() === 5 && (() => { process.env.USAGE_CLOUD_PLAN_COST = '9'; const v = cloudPlanCost(); delete process.env.USAGE_CLOUD_PLAN_COST; return v === 9 })(), 'the cost per plan can be tuned from the environment')

// ---- Not set up, busy, bad answers ----
const chargedBefore = charges.length
const none: any = await exec(make({ box: null }), { why: 'Run it', steps: [{ program: 'node', args: ['--version'] }] })
assert(none.status === 'failed' && /not been set up/.test(none.error) && charges.length === chargedBefore, 'with no box set up it says so and charges nothing')
const busy = runnerBox({ url, secret: SECRET, fetch: (async () => new Response('{}', { status: 429 })) as any })
assert(await busy.run({ steps: [{ program: 'node', args: ['--version'] }] }).then(() => false, e => e instanceof InspectError && /busy/.test(e.message)), 'a busy box is reported as busy')
const wrongSecret = runnerBox({ url, secret: 'x'.repeat(30) })
assert(await wrongSecret.run({ steps: [{ program: 'node', args: ['--version'] }] }).then(() => false, e => e instanceof InspectError && /Nothing was run/.test(e.message)), 'a wrong secret is turned away without leaking why')
const garbled = runnerBox({ url, secret: SECRET, fetch: (async () => new Response(JSON.stringify({ steps: [{ n: 1, exitCode: 'x' }] }), { status: 200 })) as any })
assert(await garbled.run({ steps: [{ program: 'node', args: ['--version'] }] }).then(() => false, e => /unreadable/.test(e.message)), 'an answer that does not fit the rules is not trusted')
assert(await box.run({ steps: [{ program: 'git', args: ['push'] }] }).then(() => false, e => /push/.test(e.message)), 'the app checks the plan again before sending it')

// ---- Setup comes only from the environment ----
assert(defaultCloudBox({}) === null && defaultCloudBox({ RUNNER_URL: 'https://x.example' } as any) === null, 'no box without both the address and the secret')
assert(defaultCloudBox({ RUNNER_URL: 'http://runner.example.com', RUNNER_SECRET: SECRET } as any) === null, 'the secret never travels over plain http to another machine')
assert(defaultCloudBox({ RUNNER_URL: 'https://runner.example.com', RUNNER_SECRET: SECRET } as any) !== null, 'an https address works')
assert(defaultCloudBox({ RUNNER_URL: 'http://127.0.0.1:8080', RUNNER_SECRET: SECRET, NODE_ENV: 'development' } as any) !== null && defaultCloudBox({ RUNNER_URL: 'http://127.0.0.1:8080', RUNNER_SECRET: SECRET, NODE_ENV: 'production' } as any) === null, 'plain http works for this machine while developing, never in production')

// ---- What the person sees ----
const part = (input: any, output: any) => ({ type: 'tool-run_in_cloud', toolCallId: 'a', state: 'output-available', input, output }) as any
const trace = getRunTrace(part({ steps: [{}, {}] }, good))
assert(trace.steps.length === 2 && trace.computer === 'a fresh cloud box' && !trace.failed, 'the trace reads the same as for a computer, and says it was a cloud box')
const tb = getRunTrace(part({ steps: [{}, {}] }, bad))
assert(tb.stopped && tb.notRun === 1 && /1 of 2 steps run/.test(tb.summary ?? ''), 'a stopped plan says how far it got')

// ---- Rate limit ----
const limited = createRunInCloudTool('cloud-rate', { box, charge, cost: () => 0 })
let last = ''
for (let i = 0; i < 6; i++) { const r: any = await (limited.execute as any)(cloudPlanSchema.parse({ why: 'Check it', steps: [{ program: 'node', args: ['--version'] }] }), {}); last = r.status }
assert(last === 'failed', 'plans are rate limited per person')

app.close()
fs.rmSync(work, { recursive: true, force: true })

// ---- If credits cannot be counted, the box stays off ----
{
  const before = charges.length
  const calls: number[] = []
  const counting = createRunInCloudTool('cloud-down', { box: { name: 'x', run: async () => { calls.push(1); return { steps: [] } } } as any, charge: async () => { throw new UsageUnavailableError() }, cost: () => 5 })
  const out: any = await (counting.execute as any)({ why: 'Try it', steps: [{ program: 'node', args: ['--version'] }] }, {})
  assert(out.status === 'failed' && /cannot be counted/.test(out.error) && /Nothing was run/.test(out.error) && calls.length === 0 && charges.length === before, 'when credits cannot be counted, no box is started')
}
