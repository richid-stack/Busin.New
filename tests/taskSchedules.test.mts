import { createFakeFirestore } from './fakeFirestore'
import { markDeleting } from '../server/services/account/tombstone'
import { ScheduleError } from '../server/services/schedule/cron'
import { taskInputSchema } from '../server/services/tasks/model'
import type { TaskStatus } from '../server/services/tasks/model'
import { SCHEDULE_LIMITS, ScheduleStoreError, createTaskScheduleStore, decideClaim, publicSchedule, readWhen, scheduleInputSchema, settlePatch, taskMinIntervalMinutes, titleFor } from '../server/services/tasks/schedules'
import type { TaskSchedule } from '../server/services/tasks/schedules'
import { runDueTaskSchedules } from '../server/services/tasks/scheduleTick'
import { createTaskStore } from '../server/services/tasks/store'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const rejects = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as Error } return null }

let clock = new Date('2026-10-26T08:00:00Z')
const at = (iso: string) => { clock = new Date(iso) }
const now = () => clock

const task = (over: Record<string, unknown> = {}) => ({ goal: 'Check the news about scholarships and write a short summary.', ...over })
const parse = (raw: unknown) => scheduleInputSchema.safeParse(raw)
const daily = { task: task(), cron: '0 9 * * *', timezone: 'Africa/Accra' }

// ---- Input ----
assert(parse(daily).success && parse({ task: task(), runAt: '2026-11-01T10:00:00Z' }).success, 'a schedule is either repeating or once')
assert(!parse({ task: task() }).success && !parse({ ...daily, runAt: '2026-11-01T10:00:00Z' }).success, 'but not neither and not both')
assert(!parse({ ...daily, task: { goal: 'short' } }).success && !parse({ ...daily, task: task({ tools: ['apps'] }) }).success, 'the task inside follows the same rules as a task made by hand')
assert(titleFor('  My   brief ', 'goal') === 'My brief' && titleFor('', 'A'.repeat(100)).length === 58 && titleFor(undefined, 'Short goal here') === 'Short goal here', 'the title defaults to the start of the goal')

// ---- Planning ----
assert(taskMinIntervalMinutes() === 60, 'a repeating task may run at most once an hour')
const rejectsWhen = (input: any) => { try { readWhen(input, clock); return null } catch (e) { return e } }
assert(rejectsWhen({ cron: '*/15 * * * *' }) instanceof ScheduleError, 'every 15 minutes is too often for a task')
assert(rejectsWhen({ cron: '0 * * * *' }) === null && rejectsWhen({ cron: '0 9 * * 1-5', timezone: 'Africa/Accra' }) === null, 'hourly and daily are fine')
assert(rejectsWhen({ cron: '0 9 * * *', timezone: 'Mars/Base' }) instanceof ScheduleError && rejectsWhen({ cron: '0 9 *' }) instanceof ScheduleError && rejectsWhen({ cron: '' }) instanceof ScheduleError, 'a bad time zone or cron is explained')
assert(rejectsWhen({ runAt: '2026-10-26T07:59:00Z' }) instanceof ScheduleError && rejectsWhen({ runAt: '2026-10-26T08:00:10Z' }) instanceof ScheduleError && rejectsWhen({ runAt: 'soon' }) instanceof ScheduleError && rejectsWhen({ runAt: '2028-01-01T00:00:00Z' }) instanceof ScheduleError, 'a one-time run must be in the future, but not years away')
assert(readWhen({ runAt: '2026-10-27T09:00:00+01:00' }, clock).runAt === '2026-10-27T08:00:00.000Z', 'a one-time run is stored as an exact moment')

const sched = (over: Partial<TaskSchedule> = {}): TaskSchedule => ({
  id: 's1', userId: 'u', title: 't', task: taskInputSchema.parse(task()), cron: '0 9 * * *', timezone: 'UTC', runAt: null, enabled: true,
  nextRunAt: '2026-10-26T09:00:00.000Z', lastRunAt: null, lastTaskId: null, lastResult: '', note: '', awaiting: false, failures: 0, runs: 0, error: '', createdAt: '', updatedAt: '', ...over
})
at('2026-10-26T09:00:30Z')
const d1 = decideClaim(sched(), clock)
assert(d1.run && d1.patch.nextRunAt === '2026-10-27T09:00:00.000Z', 'a repeating schedule moves to its next time and runs')
at('2026-10-30T09:00:30Z')
assert(decideClaim(sched(), clock).patch.nextRunAt === '2026-10-31T09:00:00.000Z', 'after an outage the next run is counted from now: one run, not a burst of catch-up runs')
at('2026-10-26T09:00:30Z')
assert(!decideClaim(sched({ enabled: false }), clock).run, 'a schedule that was switched off does not run')
const once = sched({ cron: null, runAt: '2026-10-26T09:00:00.000Z' })
const d2 = decideClaim(once, clock)
assert(d2.run && d2.patch.enabled === false && d2.patch.nextRunAt === null, 'a one-time run runs once and switches itself off')
at('2026-10-26T16:00:00Z')
const d3 = decideClaim(once, clock)
assert(!d3.run && d3.patch.lastResult === 'missed' && d3.patch.enabled === false, 'a one-time run that is hours late is marked missed, not run at a surprising time')
assert(!decideClaim(sched({ cron: '0 9 31 2 *' }), clock).run && decideClaim(sched({ cron: '0 9 31 2 *' }), clock).patch.enabled === false, 'a schedule that can no longer be worked out switches off with a reason')

const s0 = settlePatch(0, 'failed', 'x'), s2 = settlePatch(2, 'failed', 'x')
assert(s0.failures === 1 && s0.enabled === undefined && s2.failures === 3 && s2.enabled === false && s2.nextRunAt === null && String(s2.error).includes('Paused'), 'three runs in a row that did not get done pause the schedule')
assert(settlePatch(2, 'done', 'x').failures === 0 && settlePatch(2, 'partial', 'x').failures === undefined && settlePatch(2, 'needs_review', 'x').failures === undefined && settlePatch(2, 'cancelled', 'x').failures === undefined, 'a good run resets the streak; partly done, waiting and cancelled runs neither add nor reset')

// ---- Store ----
at('2026-10-26T08:00:00Z')
const db = createFakeFirestore()
const store = createTaskScheduleStore(db as any, { now })
const tasks = createTaskStore(db as any, { now })

const a = await store.create('alice', parse(daily).data!)
assert(a.enabled && a.nextRunAt === '2026-10-26T09:00:00.000Z' && a.title.startsWith('Check the news') && a.cron === '0 9 * * *' && a.runs === 0, 'a schedule starts on, with its next run worked out in its own time zone')
assert(!('userId' in publicSchedule(a)), 'the browser is not given the owner id')
assert((await store.get('bob', a.id)) === null && (await store.list('bob')).length === 0 && (await store.list('alice')).length === 1, 'people only see their own schedules')
assert(await rejects(() => store.remove('bob', a.id)) instanceof ScheduleStoreError && await rejects(() => store.setEnabled('bob', a.id, false)) instanceof ScheduleStoreError, 'and cannot change or delete another person\'s')
assert(await rejects(() => store.create('alice', parse({ task: task(), cron: '*/10 * * * *' }).data!)) instanceof ScheduleError, 'a schedule that is too frequent is refused with a reason')

const evening = { task: task(), cron: '0 18 * * *', timezone: 'UTC' }
for (let i = 0; i < SCHEDULE_LIMITS.maxActive - 1; i++) await store.create('alice', parse(evening).data!)
assert((await rejects(() => store.create('alice', parse(daily).data!)) as ScheduleStoreError)?.code === 'limit', `at most ${SCHEDULE_LIMITS.maxActive} schedules on at once`)
const paused = await store.setEnabled('alice', a.id, false)
assert(!paused.enabled && paused.nextRunAt === null, 'pausing clears the next run')
const extra = await store.create('alice', parse(evening).data!)
assert(extra.enabled, 'pausing one makes room for another')
assert((await rejects(() => store.setEnabled('alice', a.id, true)) as ScheduleStoreError)?.code === 'limit', 'and switching the paused one back on is refused while at the limit')
await store.remove('alice', extra.id)
const resumed = await store.setEnabled('alice', a.id, true)
assert(resumed.enabled && resumed.nextRunAt === '2026-10-26T09:00:00.000Z', 'resuming works the next run out from now')
const updated = await store.update('alice', a.id, parse({ task: task({ goal: 'A different goal for this schedule.' }), cron: '30 18 * * 5', timezone: 'UTC', title: 'Friday wrap-up' }).data!)
assert(updated.title === 'Friday wrap-up' && updated.task.goal.startsWith('A different') && updated.nextRunAt === '2026-10-30T18:30:00.000Z', 'editing changes what it does and when')
await store.update('alice', a.id, parse({ ...daily, timezone: 'UTC', title: 'Morning brief' }).data!)
const onceS = await store.create('bob', parse({ task: task(), runAt: '2026-10-26T10:00:00Z' }).data!)
assert(onceS.nextRunAt === '2026-10-26T10:00:00.000Z' && onceS.cron === null, 'a one-time schedule runs at its moment')
await markDeleting(db, 'carol')
assert(await rejects(() => store.create('carol', parse(daily).data!)) !== null, 'nothing is created for an account being deleted')

// ---- Timer ----
const run = async (extraDeps: Record<string, unknown> = {}) => {
  const made: Array<{ userId: string, scheduleId: string, goal: string }> = []
  const summary = await runDueTaskSchedules({
    store,
    createTask: async (userId, input, scheduleId) => { made.push({ userId, scheduleId, goal: input.goal }); return await tasks.create(userId, input, { scheduleId }) },
    getTask: (userId, id) => tasks.get(userId, id),
    now,
    ...extraDeps
  })
  return { summary, made }
}

at('2026-10-26T07:00:00Z')
assert((await run()).summary.due === 0, 'nothing runs before its time')

at('2026-10-26T10:00:20Z')
const [t1, t2] = await Promise.all([run(), run()])
assert(t1.made.length + t2.made.length === 2 && [...t1.made, ...t2.made].map(m => m.userId).sort().join() === 'alice,bob', 'two timers at once start each due schedule exactly once')
const aliceTasks = await tasks.list('alice')
assert(aliceTasks.length === 1 && aliceTasks[0]!.scheduleId !== null && aliceTasks[0]!.status === 'queued', 'a normal task is made, tagged with its schedule, waiting for the queue')
const events = await tasks.events('alice', aliceTasks[0]!.id)
assert(events[0]?.text.startsWith('Started by its schedule'), 'its log says where it came from')

const bobNow = (await store.list('bob'))[0]!
assert(!bobNow.enabled && bobNow.nextRunAt === null && bobNow.awaiting && bobNow.runs === 1 && bobNow.lastResult === 'started', 'a one-time schedule switches itself off after it starts')
const aliceFirst = (await store.list('alice')).find(s => s.lastTaskId)!
assert(aliceFirst.awaiting && aliceFirst.runs === 1 && aliceFirst.nextRunAt === '2026-10-27T09:00:00.000Z', 'a repeating schedule waits on its task and moves to tomorrow')

// Overlap: while the task is still working the next due run is skipped, not stacked.
const wait = async (s: TaskSchedule) => { await db.collection('task_schedules').doc(s.id).update({ nextRunAt: '2026-10-26T10:00:00.000Z' }) }
await wait(aliceFirst)
const overlap = await run()
assert(overlap.made.length === 0 && overlap.summary.skipped >= 1 && (await store.get('alice', aliceFirst.id))!.lastResult === 'skipped', 'a run is skipped while the one before is still going')

// Settle: finish the task as failed three times in a row.
const finish = async (taskId: string, status: TaskStatus) => { await db.collection('tasks').doc(taskId).update({ status, leaseToken: null, leaseUntil: null }) }
const failuresSeen: number[] = []
for (let round = 0; round < 3; round++) {
  const s = (await store.get('alice', aliceFirst.id))!
  await finish(s.lastTaskId!, 'failed')
  const r = await run()
  const after = (await store.get('alice', aliceFirst.id))!
  failuresSeen.push(after.failures)
  if (after.enabled && after.nextRunAt !== null) {
    await wait(after)
    const r2 = await run()
    assert(r2.made.some(m => m.scheduleId === aliceFirst.id), `after a failed run the schedule starts the next one (round ${round + 1})`)
  }
  void r
}
const dead = (await store.get('alice', aliceFirst.id))!
assert(failuresSeen.join() === '1,2,3' && !dead.enabled && dead.nextRunAt === null && dead.error.includes('Paused') && dead.lastResult === 'failed', 'three failed runs in a row pause the schedule and say why')
await wait(dead)
assert((await run()).made.every(m => m.scheduleId !== aliceFirst.id), 'a paused schedule does not run')
const back = await store.setEnabled('alice', aliceFirst.id, true)
assert(back.enabled && back.failures === 0 && back.error === '', 'switching it back on clears the pause')

// Good outcomes.
const another = (await store.list('alice')).find(s => s.id !== aliceFirst.id && s.enabled)!
await wait(another)
await run()
const anotherNow = (await store.get('alice', another.id))!
await db.collection('task_schedules').doc(another.id).update({ failures: 2 })
await finish(anotherNow.lastTaskId!, 'done')
await run()
const doneNow = (await store.get('alice', another.id))!
assert(!doneNow.awaiting && doneNow.failures === 0 && doneNow.lastResult === 'done', 'a finished run clears the waiting flag and the failure streak')

// A deleted task, and a task waiting for review, never block a schedule.
await wait(doneNow)
await run()
const again = (await store.get('alice', another.id))!
await tasks.cancel('alice', again.lastTaskId!)
await tasks.remove('alice', again.lastTaskId!)
await run()
assert((await store.get('alice', another.id))!.awaiting === false && (await store.get('alice', another.id))!.lastResult === 'cancelled', 'if the person deleted the task, the schedule just carries on')

// Limits: the person already has 3 tasks going, so the run is skipped and is not a failure.
const third = (await store.list('alice')).find(s => s.enabled && s.id !== another.id && s.id !== aliceFirst.id)!
for (const t of await tasks.list('alice')) await db.collection('tasks').doc(t.id).update({ status: 'done', leaseToken: null, leaseUntil: null })
for (let i = 0; i < 3; i++) await tasks.create('alice', taskInputSchema.parse(task()))
await wait(third)
const limited = await run()
const limitedNow = (await store.get('alice', third.id))!
assert(limited.made.length === 1 && limitedNow.lastResult === 'skipped' && limitedNow.failures === 0 && limitedNow.note.includes('3 tasks'), 'a person at their task limit has the run skipped, not counted as a failure')

// A start that fails for another reason counts as a failure.
await wait(third)
await db.collection('task_schedules').doc(third.id).update({ failures: 2 })
const broke = await run({ createTask: async () => { throw new Error('database down') } })
const brokeNow = (await store.get('alice', third.id))!
assert(broke.summary.failed >= 1 && broke.summary.paused >= 1 && !brokeNow.enabled && brokeNow.note.includes('database down'), 'a run that could not start counts toward the pause')

// Budget: with no time left nothing new starts and the rest stay due.
at('2026-10-27T09:30:00Z')
const budget = await run({ budgetMs: -1 })
assert(budget.made.length === 0 && budget.summary.deferred === budget.summary.due && budget.summary.due > 0, 'when time runs out the remaining schedules wait for the next call')
const next = await run()
assert(next.made.length > 0, 'and run on the next call')

// Account erasure removes schedules.
assert((await db.collection('task_schedules').where('userId', '==', 'bob').get()).docs.length === 1, 'schedules are stored under their owner, so account deletion can find them')
