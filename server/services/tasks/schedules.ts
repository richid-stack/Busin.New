import { z } from 'zod'
import { assertNotDeleting } from '../account/tombstone'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { ScheduleError, isValidTimeZone, nextRun } from '../schedule/cron'
import { taskInputSchema } from './model'
import type { TaskInput, TaskStatus } from './model'
import type { TaskDb } from './store'

/**
 * A task schedule is a saved task that starts itself: either on a repeating schedule or once at a set time.
 * Every start makes an ordinary task, so the log, the checks, the files and the result email all work the
 * way they do for a task started by hand. Nothing here runs a task; it only decides when to make one.
 */

export const SCHEDULE_LIMITS = {
  /** Schedules one person may have switched on at once. */
  maxActive: 5,
  /** Schedules kept per person, switched on or not. */
  maxKept: 20,
  /** A schedule whose runs fail this many times in a row is paused. Tasks cost credits, so this is lower than for workflows. */
  maxFailures: 3,
  titleMax: 80,
  /** A one-time run that is this late is skipped, not run at a surprising hour. */
  onceGraceMs: 6 * 3_600_000,
  onceMaxAheadDays: 365
}

/** The shortest gap between two runs of a repeating task schedule. Each run can use several AI calls. */
export const taskMinIntervalMinutes = () => {
  const fromEnv = Number(process.env.TASK_SCHEDULE_MIN_MINUTES)
  return Number.isFinite(fromEnv) && fromEnv >= 5 ? Math.floor(fromEnv) : 60
}

export class ScheduleStoreError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'limit' | 'invalid' = 'invalid') { super(message) }
}

export const SCHEDULE_RESULTS = ['', 'started', 'done', 'partial', 'needs_review', 'failed', 'cancelled', 'skipped', 'missed'] as const
export type ScheduleResult = typeof SCHEDULE_RESULTS[number]

export interface TaskSchedule {
  id: string
  userId: string
  title: string
  /** What every run does. Checked again by the task rules at the time it starts. */
  task: TaskInput
  /** Five-field cron for repeating schedules; null for a one-time run. */
  cron: string | null
  timezone: string
  /** When a one-time run should happen; null for repeating schedules. */
  runAt: string | null
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastTaskId: string | null
  lastResult: ScheduleResult
  /** One plain sentence about the last run, shown under the title. */
  note: string
  /** True while the task made by the last run has not finished yet. */
  awaiting: boolean
  failures: number
  runs: number
  /** Why the schedule is off, when the system switched it off. */
  error: string
  createdAt: string
  updatedAt: string
}

const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

export function fromDoc(id: string, d: Record<string, any>): TaskSchedule {
  return {
    id,
    userId: String(d.userId || ''),
    title: String(d.title || ''),
    task: d.task,
    cron: d.cron ?? null,
    timezone: String(d.timezone || 'UTC'),
    runAt: d.runAt ?? null,
    enabled: d.enabled === true,
    nextRunAt: d.nextRunAt ?? null,
    lastRunAt: d.lastRunAt ?? null,
    lastTaskId: d.lastTaskId ?? null,
    lastResult: d.lastResult ?? '',
    note: String(d.note || ''),
    awaiting: d.awaiting === true,
    failures: Number(d.failures) || 0,
    runs: Number(d.runs) || 0,
    error: String(d.error || ''),
    createdAt: String(d.createdAt || ''),
    updatedAt: String(d.updatedAt || '')
  }
}

/** What the browser is told. */
export function publicSchedule(s: TaskSchedule): Omit<TaskSchedule, 'userId'> {
  const rest: Record<string, unknown> = { ...s }
  delete rest.userId
  return rest as Omit<TaskSchedule, 'userId'>
}

// ---- Input ----

export const scheduleInputSchema = z.object({
  title: z.string().max(SCHEDULE_LIMITS.titleMax).optional(),
  task: taskInputSchema,
  cron: z.string().max(100).optional(),
  timezone: z.string().max(64).optional(),
  runAt: z.string().max(40).optional()
}).superRefine((v, ctx) => {
  const hasCron = Boolean(v.cron?.trim())
  const hasAt = Boolean(v.runAt?.trim())
  if (hasCron === hasAt) ctx.addIssue({ code: 'custom', message: 'Choose either a repeating schedule or one time to run.', path: ['cron'] })
})
export type ScheduleInput = z.infer<typeof scheduleInputSchema>

/** A readable default name, from the goal. */
export const titleFor = (title: string | undefined, goal: string) => {
  const own = (title ?? '').replace(/\s+/g, ' ').trim()
  if (own) return own.slice(0, SCHEDULE_LIMITS.titleMax)
  const first = goal.replace(/\s+/g, ' ').trim()
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first
}

// ---- Planning (pure: no clock, no database) ----

export interface When { cron: string | null, timezone: string, runAt: string | null }

/** Reads and checks when a schedule should run. Throws ScheduleError with a message the person can act on. */
export function readWhen(input: { cron?: string, timezone?: string, runAt?: string }, now: Date): When {
  const timezone = String(input.timezone || 'UTC')
  if (!isValidTimeZone(timezone)) throw new ScheduleError(`"${timezone}" is not a known time zone.`)
  if (input.runAt?.trim()) {
    const at = new Date(input.runAt)
    if (!Number.isFinite(at.getTime())) throw new ScheduleError('That date and time could not be read.')
    if (at.getTime() < now.getTime() + 30_000) throw new ScheduleError('Pick a time in the future.')
    if (at.getTime() > now.getTime() + SCHEDULE_LIMITS.onceMaxAheadDays * 86_400_000) throw new ScheduleError(`Pick a time within the next ${SCHEDULE_LIMITS.onceMaxAheadDays} days.`)
    return { cron: null, timezone, runAt: at.toISOString() }
  }
  const cron = String(input.cron ?? '').trim().replace(/\s+/g, ' ')
  // Throws when the schedule is unusable or more frequent than allowed.
  nextRun({ cron, timezone }, now, taskMinIntervalMinutes())
  return { cron, timezone, runAt: null }
}

/** The next time this schedule should run, counted from `from`. Null when there is nothing left to run. */
export function nextRunFor(s: { cron: string | null, timezone: string, runAt: string | null }, from: Date): string | null {
  if (s.runAt) return new Date(s.runAt).getTime() > from.getTime() - SCHEDULE_LIMITS.onceGraceMs ? s.runAt : null
  return nextRun({ cron: s.cron ?? '', timezone: s.timezone }, from, taskMinIntervalMinutes()).toISOString()
}

export interface ClaimDecision { patch: Record<string, unknown>, run: boolean }

/**
 * What to store when a due schedule is picked up, and whether to start a task for it. The next run is
 * counted from now, so a long outage causes one run, not a burst of catch-up runs. A one-time run that
 * is far too late is marked as missed instead of running at a surprising time.
 */
export function decideClaim(s: TaskSchedule, now: Date): ClaimDecision {
  const at = now.toISOString()
  if (!s.enabled) return { patch: { nextRunAt: null, updatedAt: at }, run: false }
  if (s.runAt) {
    const late = now.getTime() - new Date(s.runAt).getTime()
    if (late > SCHEDULE_LIMITS.onceGraceMs) {
      return { patch: { nextRunAt: null, enabled: false, lastResult: 'missed', note: 'Missed: nothing was running at the planned time, so this one-time run was skipped.', updatedAt: at }, run: false }
    }
    return { patch: { nextRunAt: null, enabled: false, updatedAt: at }, run: true }
  }
  try {
    return { patch: { nextRunAt: nextRunFor(s, now), updatedAt: at }, run: true }
  } catch (err) {
    const message = err instanceof ScheduleError ? err.message : 'The schedule could not be read.'
    return { patch: { nextRunAt: null, enabled: false, error: message, updatedAt: at }, run: false }
  }
}

/** What to store when the task a schedule started has finished: the failure streak, and a pause when it gets too long. */
export function settlePatch(previousFailures: number, status: TaskStatus | 'gone', at: string): Record<string, unknown> {
  const base = { awaiting: false, updatedAt: at }
  if (status === 'gone') return { ...base, lastResult: 'cancelled', note: 'The task from the last run was deleted.' }
  if (status === 'failed') {
    const failures = (Number(previousFailures) || 0) + 1
    const note = 'The last run did not get done.'
    if (failures >= SCHEDULE_LIMITS.maxFailures) {
      return { ...base, failures, lastResult: 'failed', note, enabled: false, nextRunAt: null, error: `Paused after ${failures} runs in a row that did not get done. Check the latest task, change what it asks for if needed, then switch the schedule on again.` }
    }
    return { ...base, failures, lastResult: 'failed', note }
  }
  if (status === 'done') return { ...base, failures: 0, lastResult: 'done', note: 'The last run finished and every check passed.' }
  if (status === 'partial') return { ...base, lastResult: 'partial', note: 'The last run finished, but not every check passed.' }
  if (status === 'needs_review') return { ...base, lastResult: 'needs_review', note: 'The last run is waiting for you to review it.' }
  return { ...base, lastResult: 'cancelled', note: 'The last run was cancelled.' }
}

// ---- Store ----

const COLLECTION = 'task_schedules'

export function createTaskScheduleStore(db: TaskDb, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ?? (() => new Date()))()
  const ref = (id: string) => db.collection(COLLECTION).doc(id)
  const all = async (userId: string) => (await db.collection(COLLECTION).where('userId', '==', userId).get()).docs.map((d: any) => fromDoc(d.id, d.data())) as TaskSchedule[]

  async function mine(userId: string, id: string): Promise<TaskSchedule | null> {
    const snap = await ref(id).get()
    if (!snap.exists) return null
    const s = fromDoc(snap.id, snap.data())
    return s.userId === userId ? s : null
  }

  function assertRoom(list: TaskSchedule[], switchingOn: boolean, selfId?: string) {
    const others = list.filter(s => s.id !== selfId)
    if (!selfId && others.length >= SCHEDULE_LIMITS.maxKept) throw new ScheduleStoreError(`You can keep ${SCHEDULE_LIMITS.maxKept} schedules. Delete one first.`, 'limit')
    if (switchingOn && others.filter(s => s.enabled).length >= SCHEDULE_LIMITS.maxActive) {
      throw new ScheduleStoreError(`You can have ${SCHEDULE_LIMITS.maxActive} schedules switched on at once. Pause one first.`, 'limit')
    }
  }

  return {
    async create(userId: string, input: ScheduleInput): Promise<TaskSchedule> {
      await assertNotDeleting(userId, db as any)
      const at = now()
      const when = readWhen(input, at)
      assertRoom(await all(userId), true)
      const r = db.collection(COLLECTION).doc()
      const doc = {
        userId, title: titleFor(input.title, input.task.goal), task: input.task, ...when, enabled: true,
        nextRunAt: nextRunFor(when, at), lastRunAt: null, lastTaskId: null, lastResult: '', note: '', awaiting: false, failures: 0, runs: 0, error: '',
        createdAt: at.toISOString(), updatedAt: at.toISOString()
      }
      await r.set(doc)
      return fromDoc(r.id, doc)
    },

    get: mine,

    async list(userId: string): Promise<TaskSchedule[]> {
      return (await all(userId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    /** Changes what a schedule does or when. Editing a schedule that is on keeps it on and counts from now. */
    async update(userId: string, id: string, input: ScheduleInput): Promise<TaskSchedule> {
      const cur = await mine(userId, id)
      if (!cur) throw new ScheduleStoreError('Schedule not found.', 'not_found')
      const at = now()
      const when = readWhen(input, at)
      const patch = {
        title: titleFor(input.title, input.task.goal), task: input.task, ...when,
        nextRunAt: cur.enabled ? nextRunFor(when, at) : null, failures: 0, error: '', updatedAt: at.toISOString()
      }
      await ref(id).update(patch)
      return fromDoc(id, { ...cur, ...patch })
    },

    /** Switches a schedule on or off. Switching on works out the next run from now and clears an earlier pause. */
    async setEnabled(userId: string, id: string, enabled: boolean): Promise<TaskSchedule> {
      const cur = await mine(userId, id)
      if (!cur) throw new ScheduleStoreError('Schedule not found.', 'not_found')
      const at = now()
      if (!enabled) {
        const patch = { enabled: false, nextRunAt: null, updatedAt: at.toISOString() }
        await ref(id).update(patch)
        return fromDoc(id, { ...cur, ...patch })
      }
      assertRoom(await all(userId), true, id)
      // Throws ScheduleError when a one-time run is already in the past.
      const when = readWhen(cur.runAt ? { runAt: cur.runAt } : { cron: cur.cron ?? '', timezone: cur.timezone }, at)
      const patch = { enabled: true, nextRunAt: nextRunFor({ ...when, timezone: cur.timezone }, at), failures: 0, error: '', updatedAt: at.toISOString() }
      await ref(id).update(patch)
      return fromDoc(id, { ...cur, ...patch })
    },

    async remove(userId: string, id: string): Promise<void> {
      if (!(await mine(userId, id))) throw new ScheduleStoreError('Schedule not found.', 'not_found')
      await ref(id).delete()
    },

    // ---- Used by the timer ----

    /** Schedules whose time has come, oldest first. */
    async findDue(nowIso: string, limit: number): Promise<Array<{ id: string, nextRunAt: string }>> {
      const snap = await db.collection(COLLECTION).where('nextRunAt', '<=', nowIso).get()
      return snap.docs.map((d: any) => ({ id: d.id as string, nextRunAt: String(d.data().nextRunAt) }))
        .sort((a: { nextRunAt: string }, b: { nextRunAt: string }) => a.nextRunAt.localeCompare(b.nextRunAt)).slice(0, limit)
    },

    /** Atomically claims one due schedule. Returns null when another tick got there first. */
    async claim(id: string, expectedNextRunAt: string, decide: (s: TaskSchedule) => ClaimDecision): Promise<{ schedule: TaskSchedule, run: boolean } | null> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        const data = snap.data()
        if (!snap.exists || !data || data.nextRunAt !== expectedNextRunAt) return null
        const schedule = fromDoc(id, data)
        const { patch, run } = decide(schedule)
        tx.update(ref(id), patch)
        return { schedule: fromDoc(id, { ...data, ...patch }), run }
      })
    },

    /** Schedules whose last task has not been looked at since it finished. */
    async findAwaiting(limit: number): Promise<TaskSchedule[]> {
      const snap = await db.collection(COLLECTION).where('awaiting', '==', true).get()
      return snap.docs.map((d: any) => fromDoc(d.id, d.data())).slice(0, limit)
    },

    async markStarted(id: string, taskId: string): Promise<void> {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        if (!snap.exists) return
        const at = now().toISOString()
        tx.update(ref(id), { lastTaskId: taskId, lastRunAt: at, lastResult: 'started', note: 'Started. The task is running.', awaiting: true, runs: (Number(snap.data().runs) || 0) + 1, updatedAt: at })
      })
    },

    /** A run that did not start a task: nothing to wait for. `failed` counts toward the pause, a plain skip does not. */
    async markNotStarted(id: string, kind: 'skipped' | 'failed', note: string): Promise<{ paused: boolean }> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        if (!snap.exists) return { paused: false }
        const at = now().toISOString()
        const patch = kind === 'failed'
          ? { ...settlePatch(Number(snap.data().failures) || 0, 'failed', at), note: clip(note, 300) }
          : { lastResult: 'skipped', note: clip(note, 300), updatedAt: at }
        tx.update(ref(id), patch)
        return { paused: (patch as Record<string, unknown>).enabled === false }
      })
    },

    /** Records how the task from the last run ended. Only applies if the schedule is still waiting on that task. */
    async settle(id: string, taskId: string, status: TaskStatus | 'gone'): Promise<{ paused: boolean }> {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref(id))
        if (!snap.exists || snap.data().lastTaskId !== taskId || snap.data().awaiting !== true) return { paused: false }
        const patch = settlePatch(Number(snap.data().failures) || 0, status, now().toISOString())
        tx.update(ref(id), patch)
        return { paused: patch.enabled === false }
      })
    }
  }
}

export type TaskScheduleStore = ReturnType<typeof createTaskScheduleStore>

let shared: TaskScheduleStore | undefined
export const taskScheduleStore = () => (shared ??= createTaskScheduleStore(getFirebaseDb() as unknown as TaskDb))
