import { createFakeFirestore } from './fakeFirestore'
import { canTransition, taskInputSchema } from '../server/services/tasks/model'
import { TaskError, createTaskStore } from '../server/services/tasks/store'
import { runTask } from '../server/services/tasks/orchestrator'
import type { RunDeps } from '../server/services/tasks/orchestrator'
import { verifyCriteria } from '../server/services/tasks/verify'
import { endTaskBrowser } from '../server/services/tasks/taskBrowser'
import { allowedToolNames } from '../server/services/tasks/registry'
import { TASK_STATUS } from '../src/types/tasks'
import { processQueue } from '../server/services/tasks/run'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }

assert(canTransition('running', 'needs_you') && canTransition('needs_you', 'queued') && canTransition('needs_you', 'failed') && canTransition('needs_you', 'cancelled') && !canTransition('needs_you', 'done') && !canTransition('needs_you', 'running') && !canTransition('queued', 'needs_you'), 'a task can pause only while running, and leaves the pause only by being answered, stopped or timed out')
assert(allowedToolNames(['browser']).includes('browser'), 'the browser may run in a task, because it pauses instead of acting alone')
assert(TASK_STATUS.needs_you.label === 'Needs you' && TASK_STATUS.needs_you.working === false, 'the app has words for the new status')

let clock = new Date('2026-10-30T10:00:00Z')
const now = () => clock
const fdb = createFakeFirestore()
const st = createTaskStore(fdb as any, { now })
const charges = { taken: 0, refunded: 0 }
const seenCtx: any[] = []
const systems: string[] = []
let script: (args: any, ctx: any, n: number) => Promise<any> = async () => ({ text: 'ok' })
let calls = 0
const deps: RunDeps = {
  store: st,
  tools: (_t, ctx) => { seenCtx.push(ctx); return {} },
  model: () => ({ id: 'google/test', model: {} as any }),
  costOf: () => 1,
  charge: async () => { charges.taken++; return { refund: async () => { charges.refunded++ } } },
  verify: async (criteria, c) => verifyCriteria(criteria, c, { judgeCheck: async () => ({ status: 'met', reason: 'fine', fix: '' }) } as any),
  generate: (async (args: any) => { systems.push(args.system); return await script(args, seenCtx.at(-1), ++calls) }) as any,
  now,
  pollMs: 15
}
const pauseAndWait = (reason: 'approval' | 'person', label: string) => async (args: any, ctx: any) => {
  await new Promise<void>((resolve, reject) => { args.abortSignal.addEventListener('abort', () => reject(new Error('aborted'))); clock = new Date(clock.getTime() + 90_000); ctx.pause({ reason, label }); void resolve })
}
const make = async () => {
  await st.create('alice', taskInputSchema.parse({ goal: 'Order a kente stole from the shop.', criteria: [{ text: 'The order was placed', kind: 'check' }], tools: ['web', 'browser'], maxMinutes: 5 }))
  return (await st.claimNext())!
}

// ---- Pausing ----
script = pauseAndWait('approval', 'Click “Place order” on shop.example.com')
let claimed = await make()
let r = await runTask(claimed.task, claimed.lease, deps)
assert(r.status === 'needs_you' && r.waiting?.reason === 'approval' && /Place order/.test(r.waiting.label), 'a step that needs the person pauses the task, saying what it is waiting for')
assert(r.attempts === 0 && charges.taken === charges.refunded && r.leaseToken === null && r.finishedAt === null, 'a pause is not an attempt, gives the credit back, and lets go of the lease')
assert(r.workedMs >= 90_000 && new Date(r.waiting!.until).getTime() - new Date(r.waiting!.since).getTime() === 30 * 60_000, 'the work so far is counted, and the wait lasts half an hour')
assert((await st.events('alice', r.id)).some(e => e.kind === 'status' && /Paused: waiting for you/.test(e.text)), 'the log says it paused')
assert(await st.claimNext() === null, 'a paused task is not picked up by a worker')
assert((await rejects(() => st.resume('bob', r.id, 'approve')) as TaskError)?.code === 'not_found', 'only the owner can answer')
assert((await rejects(() => st.resume('alice', r.id, 'continue')) as TaskError)?.code === 'invalid', 'an approval question cannot be answered with "continue"')

// ---- Approving ----
const approved = await st.resume('alice', r.id, 'approve')
assert(approved.status === 'queued' && approved.waiting === null && approved.resume?.approvedLabel === 'Click “Place order” on shop.example.com', 'approving puts the task back in the queue with exactly that step approved')
claimed = (await st.claimNext())!
clock = new Date(clock.getTime() + 20 * 60_000)
let sawApproved = ''
script = async (_a, ctx) => { sawApproved = ctx.approvedLabel; return { text: 'I placed the order.' } }
r = await runTask(claimed.task, claimed.lease, deps)
assert(sawApproved === 'Click “Place order” on shop.example.com' && /CONTINUING A TASK THAT PAUSED/.test(systems.at(-1)!) && /may be done once/.test(systems.at(-1)!), 'the next run is told what the person decided, and the tool is told which step is allowed once')
assert(r.status === 'done' && r.attempts === 1 && r.resume === null, 'the task finishes, and the decision is used up')

// ---- Declining and "continue" ----
script = pauseAndWait('approval', 'Click “Delete account” on shop.example.com')
claimed = await make()
r = await runTask(claimed.task, claimed.lease, deps)
const declined = await st.resume('alice', r.id, 'decline')
assert(declined.resume?.approvedLabel === null && /declined/.test(declined.resume!.note) && /do not look for another way/.test(declined.resume!.note), 'declining tells the next run not to do it or find another way')
await st.cancel('alice', r.id)
script = pauseAndWait('person', 'Sign in on shop.example.com')
claimed = await make()
r = await runTask(claimed.task, claimed.lease, deps)
assert(r.waiting?.reason === 'person' && (await rejects(() => st.resume('alice', r.id, 'approve')) as TaskError)?.code === 'invalid', 'a sign-in cannot be "approved", only dealt with')
const cont = await st.resume('alice', r.id, 'continue')
assert(cont.status === 'queued' && /dealt with what the page needed/.test(cont.resume!.note) && cont.resume!.approvedLabel === null, 'continuing after a sign-in approves nothing')

// ---- The time budget counts work, not waiting ----
{
  const t = (await st.claimNext())!
  clock = new Date(clock.getTime() + 60 * 60_000)
  let abortedForTime = false
  script = async (args) => { await new Promise<void>((resolve) => { args.abortSignal.addEventListener('abort', () => { abortedForTime = true; resolve() }); clock = new Date(clock.getTime() + 60_000); resolve() }); return { text: 'finished' } }
  const done = await runTask(t.task, t.lease, deps)
  assert(!abortedForTime && ['done', 'needs_review', 'partial', 'failed'].includes(done.status) && done.status !== 'needs_you', 'an hour of waiting does not use up the task\'s five minutes')
}

// ---- The wait runs out ----
script = pauseAndWait('person', 'Verify you are human on shop.example.com')
claimed = await make()
r = await runTask(claimed.task, claimed.lease, deps)
const expired = await st.expireWaiting('alice', r.id)
assert(expired?.status === 'failed' && /did not come back within 30 minutes/.test(expired.outcome) && /Verify you are human/.test(expired.outcome) && expired.finishedAt !== null, 'when nobody answers, the task stops and says why')
assert(await st.expireWaiting('alice', r.id) === null && await st.expireWaiting('bob', r.id) === null, 'expiring is a one-time thing for the owner\'s own paused task')

// ---- Stopping a paused task ----
script = pauseAndWait('approval', 'Click “Pay” on shop.example.com')
claimed = await make()
r = await runTask(claimed.task, claimed.lease, deps)
const stopped = await st.cancel('alice', r.id)
assert(stopped.status === 'cancelled' && stopped.waiting !== undefined, 'a paused task can be stopped')

// ---- Cleanup, and the queue does not call a pause "finished" ----
const closed: string[] = []; const cleared: string[] = []
await endTaskBrowser('alice', 't1', { service: { close: async (k: string) => { closed.push(k) } } as any, holds: { clear: async (k: string) => { cleared.push(k) } } as any })
assert(closed[0] === 'alice:task-t1' && cleared[0] === 'alice:task-t1', 'ending a task closes its own page and forgets its wait')
await endTaskBrowser('alice', 't2', { service: null as any })
assert(closed.length === 1, 'with no browser set up there is nothing to close')
{
  script = pauseAndWait('person', 'Sign in on shop.example.com')
  await st.create('alice', taskInputSchema.parse({ goal: 'Check my order status on the shop.', tools: ['browser'] }))
  const finishedMail: string[] = []
  const summary = await processQueue({ deps, maxTasks: 1, onFinished: async t => { finishedMail.push(t.status) } })
  assert(summary.started === 1 && finishedMail.length === 0, 'a paused task is not reported as finished, so no "task finished" email goes out')
}
