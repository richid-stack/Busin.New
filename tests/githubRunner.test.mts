import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { createFakeFirestore } from './fakeFirestore'
import { fakeGithub, fakeTime, makeZip } from './fakeGithub'
import { readZipEntry, ZipError } from '../server/utils/zip'
import { buildRunnerScript } from '../scripts/build-github-runner.mjs'
import { RUNNER_SCRIPT, RUNNER_SCRIPT_VERSION } from '../server/services/cloudbox/githubRunnerScript.generated'
import { RUNNER_FILES, SCRIPT_PATH, WORKFLOW_PATH, WORKFLOW_YAML } from '../server/services/cloudbox/githubWorkflow'
import { GithubRunError, checkConnection, githubBox, installRunner, packPlan } from '../server/services/cloudbox/github'
import { chooseCloud, connectGithub, disconnectGithub, getCloudWhere, getLink, recheckGithub, recordRun, setCloudWhere, tokenOf, viewLink } from '../server/services/cloudbox/githubStore'
import { cloudOverview } from '../server/services/cloudbox/overview'
import { createRunOnGithubTool } from '../server/utils/tools/runOnGithub'
import { setPowers, getPowers } from '../server/services/account/powers'
import { applyPowers, powerOf } from '../shared/powers'
import { cloudPlanSchema } from '../shared/cloudBox'
import { filterTools } from '../server/services/agents/profile'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const fails = async (p: Promise<unknown>) => { try { await p; return null } catch (e: any) { return e } }
process.env.SECRETS_KEY = 'github-runner-test-key-0123456789'

// ---------------------------------------------------------------- the zip reader
{
  const stored = makeZip([{ name: 'a.txt', data: 'hello', store: true }])
  const deflated = makeZip([{ name: 'dir/result.json', data: JSON.stringify({ steps: [] }).repeat(50) }, { name: 'other', data: 'x' }])
  assert(readZipEntry(stored, n => n === 'a.txt').toString() === 'hello', 'zip: reads a stored entry')
  assert(readZipEntry(deflated, n => n.endsWith('result.json')).toString().startsWith('{"steps":[]}'), 'zip: reads a deflated entry in a folder')
  assert((await fails(Promise.resolve().then(() => readZipEntry(stored, n => n === 'nope'))))instanceof ZipError, 'zip: a missing file is refused')
  assert((await fails(Promise.resolve().then(() => readZipEntry(Buffer.from('this is not a zip file at all, not even close'), () => true))))instanceof ZipError, 'zip: not a zip is refused')
  assert((await fails(Promise.resolve().then(() => readZipEntry(deflated, n => n.endsWith('result.json'), 20))))instanceof ZipError, 'zip: a file larger than the cap is refused')
  const cut = Buffer.from(deflated.subarray(0, deflated.length - 30))
  assert((await fails(Promise.resolve().then(() => readZipEntry(cut, () => true))))instanceof ZipError, 'zip: a cut-off zip is refused')
}

// ---------------------------------------------------------------- the run script that goes into the person's repo
{
  const rebuilt = await buildRunnerScript()
  assert(rebuilt.script === RUNNER_SCRIPT && rebuilt.version === RUNNER_SCRIPT_VERSION, 'script: the committed bundle is up to date (run: npm run build:github-runner)')
  assert(RUNNER_SCRIPT.length < 400_000, `script: small enough to read and store (${Math.round(RUNNER_SCRIPT.length / 1024)} KB)`)
  assert(RUNNER_FILES.map(f => f.path).join() === [WORKFLOW_PATH, SCRIPT_PATH].join(), 'script: the repo gets the workflow and the script, nothing else')

  // The workflow: only starts on request, no saved credentials, read-only job, the plan is data and never part of a command.
  assert(/on:\n {2}workflow_dispatch:/.test(WORKFLOW_YAML) && !/push:|pull_request|schedule:/.test(WORKFLOW_YAML), 'workflow: starts only when OpenLobs asks')
  assert(/persist-credentials: false/.test(WORKFLOW_YAML) && /permissions:\n {2}contents: read/.test(WORKFLOW_YAML), 'workflow: checkout keeps no credentials and the job is read-only')
  const commands = WORKFLOW_YAML.split('\n').filter(l => /^\s*run:/.test(l)).join('\n')
  assert(!/\$\{\{/.test(commands) && /OPENLOBS_PLAN: \$\{\{ inputs\.plan \}\}/.test(WORKFLOW_YAML), 'workflow: the plan reaches the script as an environment value, never inside a command')
  assert(/retention-days: 1/.test(WORKFLOW_YAML) && /if: always\(\)/.test(WORKFLOW_YAML), 'workflow: the result is kept one day and uploaded even when the job fails')

  // Run the very file that would be written to the repo, the way the workflow does.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olb-gh-'))
  const script = path.join(dir, 'run.mjs')
  fs.writeFileSync(script, RUNNER_SCRIPT)
  const run = (plan: unknown, extra: Record<string, string> = {}) => {
    const out = path.join(dir, `result-${Math.random().toString(36).slice(2)}.json`)
    execFileSync('node', [script], { env: { PATH: process.env.PATH!, OPENLOBS_RESULT: out, OPENLOBS_PLAN: typeof plan === 'string' ? plan : gzipSync(JSON.stringify(plan)).toString('base64'), RUNNER_TEMP: dir, GITHUB_TOKEN: 'ghs_must_not_leak', ...extra }, timeout: 60_000 })
    return JSON.parse(fs.readFileSync(out, 'utf8'))
  }
  const ok = run({ steps: [{ program: 'node', args: ['hello.js'] }], files: [{ path: 'hello.js', content: 'console.log("hi", process.env.GITHUB_TOKEN, Object.keys(process.env).some(k => /TOKEN|OPENLOBS/.test(k)))' }], limitMs: 60_000 })
  assert(ok.steps?.length === 1 && ok.steps[0].exitCode === 0 && /^hi undefined false/.test(ok.steps[0].output), 'script: runs a plan and the program cannot see the workflow token or the plan')
  const refused = run({ steps: [{ program: 'node', args: ['-e', '1'] }], files: [], limitMs: 60_000 })
  assert(refused.steps.length === 0 && /not allowed/.test(refused.error), 'script: the rulebook is checked again on the machine')
  const failing = run({ steps: [{ program: 'node', args: ['bad.js'] }, { program: 'node', args: ['hello.js'] }], files: [{ path: 'bad.js', content: 'process.exit(3)' }, { path: 'hello.js', content: '1' }], limitMs: 60_000 })
  assert(failing.steps.length === 1 && failing.steps[0].exitCode === 3, 'script: stops at the first failing step')
  assert(/did not arrive/.test(run('').error), 'script: a missing plan gives a plain error, not a crash')
  assert(typeof run('bm90IGd6aXA=').error === 'string', 'script: an unreadable plan gives a plain error, not a crash')
  fs.rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- checking a token
{
  const gh = fakeGithub()
  const t = gh.token
  const conn = await checkConnection(t, { fetch: gh.fetch })
  assert(conn.login === 'richie' && conn.repo === 'openlobs-runs' && conn.defaultBranch === 'main', 'check: a good token for the private repo passes')
  assert(gh.requests.every(r => r.host === 'api.github.com'), 'check: only api.github.com is called')

  const before = gh.requests.length
  const classic = await fails(checkConnection(`ghp_${'a'.repeat(36)}`, { fetch: gh.fetch }))
  assert(classic instanceof GithubRunError && /classic/.test(classic.message) && gh.requests.length === before, 'check: a classic token is refused without asking GitHub')
  await fails(checkConnection('not a token', { fetch: gh.fetch }))
  assert(gh.requests.length === before, 'check: a token with the wrong shape is refused without asking GitHub')

  const bad = fakeGithub()
  const e401 = await fails(checkConnection(`github_pat_${'B'.repeat(40)}`, { fetch: bad.fetch }))
  assert(e401?.kind === 'token' && /refused the token/.test(e401.message), 'check: a token GitHub refuses says so')

  const wide = fakeGithub({ repos: [{ full_name: 'richie/openlobs-runs', private: true }, { full_name: 'richie/bakery', private: true }] })
  const eWide = await fails(checkConnection(wide.token, { fetch: wide.fetch }))
  assert(eWide?.kind === 'token' && /more than openlobs-runs/.test(eWide.message) && /bakery/.test(eWide.message), 'check: a token that reaches other repos is refused and says which')

  const none = fakeGithub({ repos: [] })
  assert((await fails(checkConnection(none.token, { fetch: none.fetch })))?.kind === 'repo', 'check: a token that cannot see the repo is refused')

  const pub = fakeGithub({ repos: [{ full_name: 'richie/openlobs-runs', private: false }] })
  assert(/public/.test((await fails(checkConnection(pub.token, { fetch: pub.fetch })))?.message), 'check: a public repo is refused')

  const ro = fakeGithub({ repos: [{ full_name: 'richie/openlobs-runs', private: true, push: false }] })
  assert((await fails(checkConnection(ro.token, { fetch: ro.fetch })))?.kind === 'permission', 'check: a read-only token is refused')

  const arch = fakeGithub({ repos: [{ full_name: 'richie/openlobs-runs', private: true, archived: true }] })
  assert(/archived/.test((await fails(checkConnection(arch.token, { fetch: arch.fetch })))?.message), 'check: an archived repo is refused')

  const other = fakeGithub({ repos: [{ full_name: 'someoneelse/openlobs-runs', private: true }] })
  assert((await fails(checkConnection(other.token, { fetch: other.fetch })))?.kind === 'token', 'check: a repo of somebody else with the same name is not accepted')

  const down = await fails(checkConnection(t, { fetch: (async () => { throw new Error('offline') }) as any }))
  assert(down instanceof GithubRunError && !down.message.includes(t), 'check: when GitHub cannot be reached it says so, without the token')
}

// ---------------------------------------------------------------- putting the runner in the repo
{
  const gh = fakeGithub({ empty: true })
  const conn = await checkConnection(gh.token, { fetch: gh.fetch })
  const first = await installRunner(gh.token, conn, { fetch: gh.fetch })
  assert(first.changed && gh.files.size === 2 && gh.files.get(WORKFLOW_PATH)?.content === WORKFLOW_YAML && gh.files.get(SCRIPT_PATH)?.content === RUNNER_SCRIPT, 'install: an empty repo gets the workflow and the script')
  const puts = gh.requests.filter(r => r.method === 'PUT').length
  const again = await installRunner(gh.token, conn, { fetch: gh.fetch })
  assert(!again.changed && gh.requests.filter(r => r.method === 'PUT').length === puts, 'install: nothing is written when the files are already current')
  gh.files.set(SCRIPT_PATH, { content: 'old', sha: 'old1' })
  const update = await installRunner(gh.token, conn, { fetch: gh.fetch })
  assert(update.changed && gh.files.get(SCRIPT_PATH)?.content === RUNNER_SCRIPT && gh.requests.some(r => r.method === 'PUT' && r.body?.sha === 'old1'), 'install: an old script is replaced using its current version')
  assert(gh.requests.filter(r => r.method === 'PUT').every(r => !('branch' in (r.body ?? {}))), 'install: writes go to the repo\'s own default branch')

  const nowrite = fakeGithub({ denyWrite: true })
  const eWrite = await fails(installRunner(nowrite.token, { login: 'richie', repo: 'openlobs-runs', defaultBranch: 'main' }, { fetch: nowrite.fetch }))
  assert(eWrite?.kind === 'permission' && /Contents and Workflows/.test(eWrite.message), 'install: a token that cannot write says what it needs')
  const noactions = fakeGithub({ denyActions: true })
  const eActions = await fails(installRunner(noactions.token, { login: 'richie', repo: 'openlobs-runs', defaultBranch: 'main' }, { fetch: noactions.fetch }))
  assert(eActions?.kind === 'permission' && /Actions/.test(eActions.message), 'install: a token without Actions says so')
}

// ---------------------------------------------------------------- sending a plan and reading what came back
const plan = (over: any = {}) => ({
  steps: [{ program: 'node', args: ['hello.js'], why: 'Say hello' }],
  files: [{ path: 'hello.js', content: 'console.log("hello from the machine")' }],
  limitMs: 60_000,
  ...over
})
async function ready(opts: Parameters<typeof fakeGithub>[0] = {}) {
  const gh = fakeGithub(opts)
  const conn = await checkConnection(gh.token, { fetch: gh.fetch })
  await installRunner(gh.token, conn, { fetch: gh.fetch })
  const time = fakeTime()
  const box = githubBox(conn, gh.token, { fetch: gh.fetch, sleep: time.sleep, now: time.now })
  return { gh, conn, time, box }
}
{
  const { gh, box } = await ready({ listAfter: 1, finishAfter: 3, runSeconds: 74 })
  const reply = await box.run(plan())
  assert(reply.steps.length === 1 && reply.steps[0]!.exitCode === 0 && /hello from the machine/.test(reply.steps[0]!.output), 'run: the plan runs for real and its output comes back')
  assert(reply.minutes === 2, 'run: 74 seconds of machine time counts as 2 of the free minutes')
  assert(reply.seconds > 0, 'run: the time it took is reported')
  assert(gh.deleted.length === 1 && gh.runs.length === 0, 'run: the run is deleted from the person\'s repo after the result is read')
  const dispatch = gh.requests.find(r => r.path.endsWith('/dispatches'))!
  assert(dispatch.body.ref === 'main' && Object.keys(dispatch.body.inputs).sort().join() === 'plan,run_id', 'run: the plan goes in as the two inputs the workflow expects')
  const blob = gh.requests.filter(r => r.host !== 'api.github.com')
  assert(blob.length === 1 && blob[0]!.auth === null, 'run: the token is not sent to the storage host the result is downloaded from')
  assert(gh.requests.filter(r => r.host === 'api.github.com').every(r => r.auth === `Bearer ${gh.token}`), 'run: every call to GitHub carries the token')
  assert(gh.listCalls >= 2, 'run: it keeps looking until the run shows up')
}
{
  const { box, gh } = await ready({ result: () => ({ steps: [{ n: 1, exitCode: 1, timedOut: false, ms: 20, output: 'boom', outputTruncated: false }] }) })
  const reply = await box.run(plan())
  assert(reply.steps[0]!.exitCode === 1 && reply.steps[0]!.output === 'boom' && gh.deleted.length === 1, 'run: a failing step comes back as it is, and the run is still deleted')
}
{
  const { box } = await ready()
  const e = await fails(box.run({ steps: [{ program: 'sh', args: ['-c', 'x'] }], files: [] }))
  assert(e instanceof GithubRunError && e.kind === 'other', 'run: a plan the rulebook refuses is not sent')
  const big = await fails(box.run(plan({ files: Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.txt`, content: Array.from({ length: 9_000 }, () => Math.random().toString(36)).join('') })) })))
  assert(big?.kind === 'size' || big?.kind === 'other', 'run: a plan too big for GitHub\'s inputs is refused in plain words')
  assert((await fails(Promise.resolve().then(() => packPlan({ files: [{ content: Array.from({ length: 12_000 }, () => Math.random().toString(36)).join('') }] }))))?.kind === 'size', 'run: packPlan refuses what would not fit')
}
{
  const { box, gh } = await ready({ dispatchFails: { status: 404, times: 1 } })
  const reply = await box.run(plan())
  assert(reply.steps.length === 1 && gh.requests.filter(r => r.path.endsWith('/dispatches')).length === 2, 'run: a workflow GitHub has not indexed yet is asked again')
}
{
  const { box } = await ready({ dispatchFails: { status: 404, times: 9 } })
  const e = await fails(box.run(plan()))
  assert(e?.kind === 'repo' && /Check again/.test(e.message), 'run: a workflow that never turns up tells the person how to put it back')
}
{
  const { box, gh } = await ready({ finishAfter: Infinity })
  const e = await fails(box.run(plan()))
  assert(e?.kind === 'busy' && /took too long/.test(e.message) && gh.cancelled.length === 1, 'run: a run that does not finish in time is stopped on GitHub and reported')
}
{
  const { box, gh } = await ready({ listAfter: 999 })
  const e = await fails(box.run(plan()))
  assert(e?.kind === 'busy' && /did not start/.test(e.message) && gh.cancelled.length === 0, 'run: a run that never starts is reported (nothing to stop)')
}
{
  const { box, gh } = await ready({ noArtifact: true, conclusion: 'failure' })
  const e = await fails(box.run(plan()))
  assert(/gave no result/.test(e?.message) && gh.deleted.length === 1, 'run: a job that gave no result is reported, and cleaned up')
}
{
  const { box } = await ready({ blobHost: 'evil.example.com' })
  const e = await fails(box.run(plan()))
  assert(/unexpected place/.test(e?.message), 'run: a result that is sent from a host that is not GitHub\'s storage is not fetched')
}
{
  const { box, gh } = await ready({ result: () => ({ steps: 'nonsense' } as any) })
  const e = await fails(box.run(plan()))
  assert(/not understood/.test(e?.message) && gh.deleted.length === 1, 'run: a result in the wrong shape is refused')
}
{
  const { gh } = await ready({ finishAfter: Infinity })
  const ctl = new AbortController()
  let sleeps = 0
  // Closes the chat while the run is being waited on (the second wait), the way a real sleep would be cut short.
  const sleep = async () => { if (++sleeps >= 2) { ctl.abort(new Error('closed')); throw ctl.signal.reason } }
  const slow = githubBox({ login: 'richie', repo: 'openlobs-runs', defaultBranch: 'main' }, gh.token, { fetch: gh.fetch, sleep, now: () => 1_000_000 })
  const e = await fails(slow.run(plan(), ctl.signal))
  assert(e instanceof Error && /closed/.test(e.message) && gh.cancelled.length === 1, 'run: closing the chat stops waiting and stops the run on GitHub')
}
{
  const { gh, conn } = await ready()
  const stale = githubBox(conn, `github_pat_${'Z'.repeat(40)}`, { fetch: gh.fetch, sleep: async () => {}, now: () => 1 })
  const e = await fails(stale.run(plan()))
  assert(e?.kind === 'token', 'run: a token that stopped working is reported as a token problem')
}

// ---------------------------------------------------------------- the stored link and where plans go
{
  const db = createFakeFirestore()
  const gh = fakeGithub()
  const deps = { fetch: gh.fetch }
  assert((await cloudOverview(db as any, 'u1', {} as any)).chosen === null, 'store: nothing is offered when there is no box and no GitHub')
  assert((await cloudOverview(db as any, 'u1', { RUNNER_URL: 'https://box.example.com', RUNNER_SECRET: 'x'.repeat(30) } as any)).chosen === 'box', 'store: the OpenLobs box is offered when this app has one')

  const bad = await fails(connectGithub(db as any, 'u1', `github_pat_${'Q'.repeat(40)}`, deps))
  assert(bad instanceof GithubRunError && (await getLink(db as any, 'u1')) === null, 'store: a token that fails a check is never stored')

  const status = await connectGithub(db as any, 'u1', gh.token, deps)
  assert(status.connected && status.login === 'richie' && status.repo === 'openlobs-runs', 'store: connecting returns who and which repo')
  const stored = JSON.stringify(await getLink(db as any, 'u1'))
  assert(!stored.includes(gh.token) && !JSON.stringify(status).includes(gh.token), 'store: the token is stored sealed and never shown')
  const link = (await getLink(db as any, 'u1'))!
  assert(link.sealedToken.startsWith('v1.') && tokenOf(link) === gh.token, 'store: the sealed token opens to the same token')
  assert(!JSON.stringify(viewLink(link)).includes('sealed'), 'store: the view has no token field')
  assert((await getCloudWhere(db as any, 'u1')) === 'github', 'store: the first connection makes GitHub the place plans go')
  const ov = await cloudOverview(db as any, 'u1', {} as any)
  assert(ov.chosen === 'github' && ov.github.connected && !ov.box, 'store: the overview says GitHub is chosen')

  await setPowers(db as any, 'u1', { web: false })
  await setCloudWhere(db as any, 'u1', 'box')
  const powers = await getPowers(db as any, 'u1')
  assert(powers.web === false && (await getCloudWhere(db as any, 'u1')) === 'box', 'store: the choice and the powers live side by side without overwriting each other')
  await setPowers(db as any, 'u1', { cloud: true })
  assert((await getCloudWhere(db as any, 'u1')) === 'box', 'store: changing a power keeps the choice')

  await recordRun(db as any, 'u1', { at: 'now', seconds: 40, minutes: 1, ok: true })
  assert((await getLink(db as any, 'u1'))!.lastRun?.minutes === 1, 'store: the last run is remembered')
  const second = await recheckGithub(db as any, 'u1', deps)
  assert(second.connected && second.lastRun?.minutes === 1, 'store: checking again keeps what was remembered')
  gh.token = `github_pat_${'R'.repeat(40)}`
  assert(await fails(recheckGithub(db as any, 'u1', deps)) instanceof GithubRunError, 'store: a stored token that stopped working fails the check')

  await setCloudWhere(db as any, 'u1', 'github')
  await disconnectGithub(db as any, 'u1')
  assert((await getLink(db as any, 'u1')) === null && (await getCloudWhere(db as any, 'u1')) === null, 'store: disconnecting forgets the token and the choice of GitHub')
  assert((await recheckGithub(db as any, 'u1', deps)).connected === false, 'store: checking with nothing connected says not connected')

  const table: Array<[any, boolean, boolean, string | null]> = [
    [null, false, false, null], [null, true, false, 'github'], [null, false, true, 'box'], [null, true, true, 'github'],
    ['box', true, true, 'box'], ['box', true, false, 'github'], ['box', false, false, null],
    ['github', true, true, 'github'], ['github', false, true, 'box'], ['github', false, false, null]
  ]
  assert(table.every(([where, linked, box, want]) => chooseCloud({ where, linked, box }) === want), 'choose: the person\'s choice wins when it can work, otherwise GitHub, then the box, then nothing')
}

// ---------------------------------------------------------------- the tool
{
  const records: any[] = []
  const ok = fakeGithub()
  const conn = await checkConnection(ok.token, { fetch: ok.fetch })
  await installRunner(ok.token, conn, { fetch: ok.fetch })
  const time = fakeTime()
  const real = githubBox(conn, ok.token, { fetch: ok.fetch, sleep: time.sleep, now: time.now })
  let who = 0
  // Each call is a different person, so the tool's own four-a-minute limit is not what is being tested.
  const make = (box: any) => createRunOnGithubTool(`tool-user-${++who}`, { box: async () => box, record: async (_: string, r: any) => { records.push(r) } })
  const run = (t: any, input: any) => (t.execute as any)(cloudPlanSchema.parse(input), {})
  const t: any = make(real)

  assert(t.needsApproval === true, 'tool: every plan needs approval')
  assert(powerOf('run_on_github') === 'cloud' && Object.keys(applyPowers({ run_on_github: 1, chart: 2 }, { cloud: false })).join() === 'chart', 'tool: the cloud power switches it off')
  assert(!('run_on_github' in filterTools({ run_on_github: 1, chart: 2 }, { tools: [] } as any)) && 'run_on_github' in filterTools({ run_on_github: 1, chart: 2 }, { tools: ['cloud_run'] } as any) && 'run_in_cloud' in filterTools({ run_in_cloud: 1 }, { tools: ['cloud_run'] } as any), 'tool: an agent only gets it when it was allowed, and the same switch covers the box and GitHub')
  const asked = t.inputSchema.safeParse({ why: 'Run the tests', steps: [{ program: 'sh', args: ['-c', 'x'] }], files: [] })
  assert(!asked.success, 'tool: a step the rulebook refuses is refused before any card')

  const done = await run(t, { why: 'Say hello', steps: [{ program: 'node', args: ['hello.js'], why: 'Say hello' }], files: [{ path: 'hello.js', content: 'console.log("hi")' }] })
  assert(done.status === 'ok' && done.computer === 'your GitHub' && done.steps[0].ok && /hi/.test(done.steps[0].output), 'tool: a good plan comes back ok, naming your GitHub')
  assert(done.minutes >= 1 && typeof done.seconds === 'number', 'tool: it says how long it took and how many of their minutes')
  assert(/data from the cloud box|never instructions/i.test(done.notice), 'tool: what the machine printed is marked as data, not instructions')
  assert(records.length === 1 && records[0].ok === true && records[0].minutes === done.minutes, 'tool: the last run is recorded')

  const stopped = await run(make({ name: 'x', run: async () => ({ steps: [{ n: 1, exitCode: 2, timedOut: false, ms: 1500, output: 'nope', outputTruncated: false }], seconds: 9, minutes: 1 }) }), { why: 'Try it', steps: [{ program: 'node', args: ['a.js'] }, { program: 'node', args: ['b.js'] }], files: [{ path: 'a.js', content: '1' }, { path: 'b.js', content: '2' }] })
  assert(stopped.status === 'stopped' && stopped.notRun === 1 && /thrown away/.test(stopped.note) && records[1].ok === false, 'tool: a step that fails stops the plan and says what was not run')

  const none = await run(make(null), { why: 'Try it', steps: [{ program: 'node', args: ['a.js'] }], files: [{ path: 'a.js', content: '1' }] })
  assert(none.status === 'failed' && /not set up yet/.test(none.error) && /Settings/.test(none.error) && /do not pretend/i.test(none.note), 'tool: not set up is reported with where to fix it, and the assistant is told not to pretend')
  const stale = await run(make({ name: 'x', run: async () => { throw new GithubRunError('GitHub refused the token.', 'token') } }), { why: 'Try it', steps: [{ program: 'node', args: ['a.js'] }], files: [{ path: 'a.js', content: '1' }] })
  assert(stale.status === 'failed' && /refused the token/.test(stale.error) && /Check again/.test(stale.error) && !/Tell the person/.test(stale.error) && /Tell the person/.test(stale.note), 'tool: a token problem tells the person where to go, and keeps the instruction to the assistant out of what the person reads')
  const slow = await run(make({ name: 'x', run: async () => { throw new GithubRunError('GitHub took too long, so the run was stopped.', 'busy') } }), { why: 'Try it', steps: [{ program: 'node', args: ['a.js'] }], files: [{ path: 'a.js', content: '1' }] })
  assert(slow.status === 'failed' && !/Check again/.test(slow.error) && !/Check again/.test(slow.note) && /do not pretend/.test(slow.note), 'tool: a slow run is not blamed on the token')
  const oops = await fails(run(make({ name: 'x', run: async () => { throw new TypeError('bug') } }), { why: 'Try it', steps: [{ program: 'node', args: ['a.js'] }], files: [{ path: 'a.js', content: '1' }] }))
  assert(oops === null || oops instanceof Error, 'tool: an unexpected error is handled by the shared limits')
  const result = await run(make({ name: 'x', run: async () => ({ steps: [], error: 'Step 1: not allowed.', seconds: 1, minutes: 1 }) }), { why: 'Try it', steps: [{ program: 'node', args: ['a.js'] }], files: [{ path: 'a.js', content: '1' }] })
  assert(result.status === 'failed' && /not allowed/.test(result.error), 'tool: a plan the machine refused is reported as nothing run')
}

console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED')
