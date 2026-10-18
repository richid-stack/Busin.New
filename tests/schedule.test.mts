import { nextRun, upcomingRuns, ScheduleError, MAX_SCHEDULED_PER_USER, findScheduleNode, scheduleFieldsFor } from '../server/services/schedule/cron'
import { assertScheduleCap, planScheduleUpdate, outcomePatch } from '../server/services/schedule/plan'
import { runDueWorkflows } from '../server/services/schedule/tick'
import type { DueWorkflow, ScheduleStore } from '../server/services/schedule/tick'
import { secretMatches } from '../server/utils/secretCompare'
import { buildCron, parseCron } from '../src/utils/schedulePresets'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const throwsSchedule = (fn: () => unknown, part?: RegExp) => {
  try { fn(); return false } catch (e: any) { return e instanceof ScheduleError && (!part || part.test(e.message)) }
}

// ---- Cron rules ----
const from = new Date('2026-10-14T10:00:00Z') // a Wednesday
assert(nextRun({ cron: '0 9 * * 1-5', timezone: 'UTC' }, from).toISOString() === '2026-10-15T09:00:00.000Z', 'weekday 09:00 UTC picks the next morning')
assert(nextRun({ cron: '0 9 * * *', timezone: 'Africa/Accra' }, from).toISOString() === '2026-10-15T09:00:00.000Z', 'Accra is UTC+0')
assert(nextRun({ cron: '0 9 * * *', timezone: 'America/New_York' }, from).toISOString() === '2026-10-14T13:00:00.000Z', 'time zones shift the run (EDT is UTC-4)')
assert(nextRun({ cron: '0 9 * * *', timezone: 'Asia/Kolkata' }, from).toISOString() === '2026-10-15T03:30:00.000Z', 'half-hour zones work')
assert(throwsSchedule(() => nextRun({ cron: '', timezone: 'UTC' }, from), /Choose when/), 'an empty schedule is refused')
assert(throwsSchedule(() => nextRun({ cron: '* * * *', timezone: 'UTC' }, from), /five parts/), 'four fields are refused')
assert(throwsSchedule(() => nextRun({ cron: '0 9 * * *', timezone: 'Mars/Base' }, from), /time zone/), 'unknown time zones are refused')
assert(throwsSchedule(() => nextRun({ cron: '61 9 * * *', timezone: 'UTC' }, from)), 'out-of-range values are refused')
assert(throwsSchedule(() => nextRun({ cron: '0 9 31 2 *', timezone: 'UTC' }, from)), 'a date that never happens is refused')
assert(throwsSchedule(() => nextRun({ cron: '* * * * *', timezone: 'UTC' }, from), /shortest allowed gap/), 'every minute is too frequent')
assert(throwsSchedule(() => nextRun({ cron: '*/10 * * * *', timezone: 'UTC' }, from), /15 minutes/), 'every 10 minutes is too frequent')
assert(throwsSchedule(() => nextRun({ cron: '0,5 9 * * *', timezone: 'UTC' }, from), /shortest allowed gap/), 'uneven schedules with a short gap are caught')
assert(!throwsSchedule(() => nextRun({ cron: '*/15 * * * *', timezone: 'UTC' }, from)), 'every 15 minutes is allowed')
assert(!throwsSchedule(() => nextRun({ cron: '*/5 * * * *', timezone: 'UTC' }, from, 5)), 'the minimum can be lowered')

// Daylight saving: New York clocks go forward on 2027-03-14; a 09:00 local run stays at 09:00 local.
const beforeDst = upcomingRuns({ cron: '0 9 * * *', timezone: 'America/New_York' }, new Date('2027-03-12T20:00:00Z'), 3).map(d => d.toISOString())
assert(beforeDst[0] === '2027-03-13T14:00:00.000Z' && beforeDst[1] === '2027-03-14T13:00:00.000Z', 'a daily 09:00 run follows the clock change')

// ---- Preset form ----
assert(buildCron({ kind: 'weekdays', time: '08:30', weekday: 1, monthDay: 1 }) === '30 8 * * 1-5', 'weekday preset builds cron')
assert(buildCron({ kind: 'weekly', time: '17:05', weekday: 0, monthDay: 1 }) === '5 17 * * 0', 'weekly preset builds cron')
assert(buildCron({ kind: 'monthly', time: '09:00', weekday: 1, monthDay: 31 }) === '0 9 28 * *', 'monthly days are capped at 28')
for (const cron of ['*/15 * * * *', '20 * * * *', '0 9 * * *', '30 8 * * 1-5', '5 17 * * 0', '0 9 15 * *']) {
  assert(buildCron(parseCron(cron)) === cron, `preset round-trips: ${cron}`)
}
assert(parseCron('0 9 * 3 *').kind === 'custom' && parseCron('0 9 1,15 * *').kind === 'custom' && parseCron('nonsense').kind === 'custom', 'unusual cron stays custom')

// ---- Saving a workflow ----
const trigger = (schedule: any) => ({ id: 't', type: 'trigger', data: { subtype: 'schedule', schedule } })
const nodes = (cron = '0 9 * * *'): any[] => [trigger({ cron, timezone: 'UTC' }), { id: 'a', type: 'agent', data: {} }]
const now = new Date('2026-10-14T10:00:00Z')

assert(findScheduleNode(nodes())?.id === 't', 'finds the schedule trigger')
assert(scheduleFieldsFor({ status: 'active', nodes: nodes() }, now).scheduleNextRunAt === '2026-10-15T09:00:00.000Z', 'an active schedule gets a next run')
assert(scheduleFieldsFor({ status: 'paused', nodes: nodes() }, now).scheduleNextRunAt === null, 'a paused workflow has no next run')
assert(scheduleFieldsFor({ status: 'active', nodes: [{ type: 'trigger', data: { subtype: 'webhook' } }] }, now).scheduleNextRunAt === null, 'no schedule trigger, no next run')
assert(throwsSchedule(() => scheduleFieldsFor({ status: 'active', nodes: nodes('* * * * *') }, now)), 'an active workflow with a bad schedule cannot be saved')
assert(!throwsSchedule(() => scheduleFieldsFor({ status: 'draft', nodes: nodes('* * * * *') }, now)), 'a draft with a bad schedule can still be saved')

const stored = { status: 'active', nodes: nodes(), scheduleNextRunAt: '2026-10-14T09:00:00.000Z' } // already due
assert(planScheduleUpdate(stored, { status: 'active', nodes: [...nodes(), { id: 'b', type: 'action', data: {} }] }, now) === null, 'autosave of other changes leaves a due run alone')
assert(planScheduleUpdate(stored, { status: 'active', nodes: nodes('0 10 * * *') }, now)?.scheduleNextRunAt === '2026-10-15T10:00:00.000Z', 'changing the schedule recalculates it')
assert(planScheduleUpdate(stored, { status: 'paused', nodes: nodes() }, now)?.scheduleNextRunAt === null, 'pausing clears the next run')
assert(planScheduleUpdate({ status: 'paused', nodes: nodes() }, { status: 'active', nodes: nodes() }, now)?.scheduleNextRunAt === '2026-10-15T09:00:00.000Z', 'switching on starts the schedule')
assert(planScheduleUpdate(stored, { status: 'active', nodes: [{ type: 'agent', data: {} }] }, now)?.scheduleNextRunAt === null, 'removing the trigger clears the next run')
assert(planScheduleUpdate(null, { status: 'active', nodes: nodes() }, now)?.scheduleNextRunAt != null, 'a new active workflow is scheduled')

const others = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, scheduleNextRunAt: '2026-10-15T09:00:00.000Z' }))
const on = { scheduleNextRunAt: '2026-10-15T09:00:00.000Z', scheduleError: null, scheduleFailures: 0 }
assert(!throwsSchedule(() => assertScheduleCap(on, others(MAX_SCHEDULED_PER_USER - 1), 'new')), 'below the cap is fine')
assert(throwsSchedule(() => assertScheduleCap(on, others(MAX_SCHEDULED_PER_USER), 'new'), /5 scheduled/), 'at the cap, another is refused')
assert(!throwsSchedule(() => assertScheduleCap(on, others(MAX_SCHEDULED_PER_USER), 'w0')), 'a workflow already counted can be saved again')
assert(!throwsSchedule(() => assertScheduleCap({ ...on, scheduleNextRunAt: null }, others(MAX_SCHEDULED_PER_USER), 'new')), 'switching off is never refused')

// ---- Failure streaks ----
assert(outcomePatch(0, true).patch.scheduleFailures === 1 && !outcomePatch(0, true).paused, 'one failure is counted')
assert(outcomePatch(3, false).patch.scheduleFailures === 0, 'a success resets the streak')
const fifth = outcomePatch(4, true)
assert(fifth.paused && fifth.patch.status === 'paused' && fifth.patch.scheduleNextRunAt === null && /5 failed/.test(String(fifth.patch.scheduleError)), 'the fifth failure in a row pauses it with a message')

// ---- The timer ----
function memoryStore(initial: DueWorkflow[]) {
  const rows = new Map(initial.map(w => [w.id, { ...w } as any]))
  const store: ScheduleStore = {
    async findDue(nowIso, limit) {
      return [...rows.values()].filter(w => w.scheduleNextRunAt && w.scheduleNextRunAt <= nowIso)
        .sort((a, b) => a.scheduleNextRunAt.localeCompare(b.scheduleNextRunAt)).slice(0, limit)
        .map(w => ({ id: w.id, nextRunAt: w.scheduleNextRunAt }))
    },
    async claim(id, expected, decide) {
      await Promise.resolve() // let a competing tick interleave, as two requests would
      const row = rows.get(id)
      if (!row || row.scheduleNextRunAt !== expected) return null
      const snapshot = structuredClone(row) as DueWorkflow
      const { patch, run } = decide(snapshot)
      Object.assign(row, patch)
      return { workflow: snapshot, run }
    },
    async recordOutcome(id, failed) {
      const row = rows.get(id)
      if (!row) return { paused: false }
      const { patch, paused } = outcomePatch(row.scheduleFailures ?? 0, failed)
      Object.assign(row, patch)
      return { paused }
    }
  }
  return { store, rows }
}
const wf = (id: string, over: Partial<DueWorkflow> = {}): DueWorkflow => ({
  id, userId: 'u1', status: 'active', nodes: nodes(), scheduleNextRunAt: '2026-10-14T09:00:00.000Z', scheduleFailures: 0, ...over
})
const clock = (iso: string) => () => new Date(iso)

{
  const { store, rows } = memoryStore([wf('a')])
  const runs: any[] = []
  const summary = await runDueWorkflows({ store, now: clock('2026-10-14T10:00:00Z'), run: async (w, input) => { runs.push({ w, input }); return { status: 'completed' } } })
  assert(summary.due === 1 && summary.started === 1 && runs.length === 1, 'a due workflow runs once')
  assert(runs[0].input.t.event === 'schedule' && runs[0].input.t.scheduledFor === '2026-10-14T09:00:00.000Z' && runs[0].input.t.cron === '0 9 * * *', 'the trigger gets the schedule details')
  assert(rows.get('a').scheduleNextRunAt === '2026-10-15T09:00:00.000Z', 'its next run is set for tomorrow')
  const again = await runDueWorkflows({ store, now: clock('2026-10-14T10:01:00Z'), run: async () => { throw new Error('should not run') } })
  assert(again.due === 0 && again.started === 0, 'nothing runs twice')
}

{ // two ticks at once: one run
  const { store } = memoryStore([wf('a')])
  let count = 0
  const opts = { store, now: clock('2026-10-14T10:00:00Z'), run: async () => { count++; return { status: 'completed' } } }
  const [x, y] = await Promise.all([runDueWorkflows(opts), runDueWorkflows(opts)])
  assert(count === 1 && x.started + y.started === 1 && x.skipped + y.skipped === 1, 'two overlapping ticks start it once')
}

{ // a long outage runs once, not a burst
  const { store, rows } = memoryStore([wf('a', { scheduleNextRunAt: '2026-10-10T09:00:00.000Z' })])
  let count = 0
  await runDueWorkflows({ store, now: clock('2026-10-14T10:00:00Z'), run: async () => { count++; return { status: 'completed' } } })
  assert(count === 1 && rows.get('a').scheduleNextRunAt === '2026-10-15T09:00:00.000Z', 'missed runs are not replayed')
}

{ // paused or edited since it was queued
  const { store, rows } = memoryStore([wf('p', { status: 'paused' }), wf('n', { nodes: [] }), wf('bad', { nodes: nodes('* * * * *') })])
  let count = 0
  const summary = await runDueWorkflows({ store, now: clock('2026-10-14T10:00:00Z'), run: async () => { count++; return { status: 'completed' } } })
  assert(count === 0 && summary.skipped === 3, 'paused, trigger-less and invalid workflows do not run')
  assert(rows.get('p').scheduleNextRunAt === null && rows.get('n').scheduleNextRunAt === null, 'they are taken off the timer')
  assert(rows.get('bad').scheduleNextRunAt === null && /shortest allowed gap/.test(rows.get('bad').scheduleError), 'an invalid schedule is switched off with the reason')
}

{ // failures pause after five in a row
  const { store, rows } = memoryStore([wf('f')])
  let last
  for (let i = 0; i < 5; i++) {
    rows.get('f').scheduleNextRunAt = '2026-10-14T09:00:00.000Z'
    last = await runDueWorkflows({ store, now: clock('2026-10-14T10:00:00Z'), run: async () => ({ status: 'failed' }) })
  }
  assert(rows.get('f').status === 'paused' && rows.get('f').scheduleNextRunAt === null && last?.paused === 1, 'five failed runs in a row pause the workflow')
}

{ // a thrown error counts as a failure; success resets; approval waits do not count
  const { store, rows } = memoryStore([wf('e', { scheduleFailures: 2 })])
  const quiet = console.error; console.error = () => {}
  const thrown = await runDueWorkflows({ store, now: clock('2026-10-14T10:00:00Z'), run: async () => { throw new Error('db down') } })
  console.error = quiet
  assert(thrown.failed === 1 && rows.get('e').scheduleFailures === 3, 'an error while running counts as a failure')
  rows.get('e').scheduleNextRunAt = '2026-10-14T09:00:00.000Z'
  await runDueWorkflows({ store, now: clock('2026-10-14T10:00:00Z'), run: async () => ({ status: 'waiting_approval' }) })
  assert(rows.get('e').scheduleFailures === 3, 'waiting for approval leaves the streak alone')
  rows.get('e').scheduleNextRunAt = '2026-10-14T09:00:00.000Z'
  await runDueWorkflows({ store, now: clock('2026-10-14T10:00:00Z'), run: async () => ({ status: 'completed' }) })
  assert(rows.get('e').scheduleFailures === 0, 'a good run resets the streak')
}

{ // budget: the rest wait for the next call
  const { store, rows } = memoryStore([wf('1'), wf('2', { scheduleNextRunAt: '2026-10-14T09:01:00.000Z' }), wf('3', { scheduleNextRunAt: '2026-10-14T09:02:00.000Z' })])
  let t = Date.parse('2026-10-14T10:00:00Z')
  const summary = await runDueWorkflows({ store, concurrency: 1, budgetMs: 1000, now: () => new Date(t), run: async () => { t += 2000; return { status: 'completed' } } })
  assert(summary.started === 1 && summary.deferred === 2, 'after the time budget, remaining workflows are deferred')
  assert(rows.get('2').scheduleNextRunAt === '2026-10-14T09:01:00.000Z', 'deferred workflows stay due')
}

{ // limit per call
  const { store } = memoryStore(Array.from({ length: 5 }, (_, i) => wf(`w${i}`, { scheduleNextRunAt: `2026-10-14T09:0${i}:00.000Z` })))
  const summary = await runDueWorkflows({ store, limit: 2, now: clock('2026-10-14T10:00:00Z'), run: async () => ({ status: 'completed' }) })
  assert(summary.due === 2 && summary.started === 2, 'at most `limit` workflows are handled per call, oldest first')
}

// ---- The shared secret ----
assert(secretMatches('s3cret-value-1234', 's3cret-value-1234'), 'the right secret matches')
assert(!secretMatches('s3cret-value-1235', 's3cret-value-1234') && !secretMatches('', 's3cret-value-1234') && !secretMatches('short', 's3cret-value-1234'), 'wrong, empty and shorter secrets do not match')
