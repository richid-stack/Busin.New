import { mapWithConcurrency } from '../../utils/workflowNodes'
import { TaskError } from './store'
import { decideClaim } from './schedules'
import type { TaskScheduleStore, TaskSchedule } from './schedules'
import type { Task, TaskInput } from './model'
import { isFinal } from './model'

export interface ScheduleTickSummary {
  /** Schedules whose last task was looked at and recorded. */
  settled: number
  due: number
  started: number
  skipped: number
  failed: number
  paused: number
  deferred: number
}

export interface ScheduleTickDeps {
  store: Pick<TaskScheduleStore, 'findDue' | 'claim' | 'findAwaiting' | 'markStarted' | 'markNotStarted' | 'settle'>
  /** Makes a normal task from the schedule's template. Throws TaskError('limit') when the person is at their limit. */
  createTask: (userId: string, input: TaskInput, scheduleId: string) => Promise<Pick<Task, 'id'>>
  getTask: (userId: string, id: string) => Promise<Pick<Task, 'status'> | null>
  now?: () => Date
  limit?: number
  /** After this long no new schedule is started; the rest stay due for the next call. */
  budgetMs?: number
  concurrency?: number
}

/**
 * Starts a task for every schedule whose time has come, and records how earlier runs ended.
 * Safe to call from several places at once: a due schedule is claimed by exactly one caller.
 * It never runs a task itself; the task queue does that.
 */
export async function runDueTaskSchedules(deps: ScheduleTickDeps): Promise<ScheduleTickSummary> {
  const now = deps.now ?? (() => new Date())
  const startedAt = now().getTime()
  const budgetMs = deps.budgetMs ?? 60_000
  const summary: ScheduleTickSummary = { settled: 0, due: 0, started: 0, skipped: 0, failed: 0, paused: 0, deferred: 0 }

  // First record how earlier runs ended, so a schedule that just failed its third run does not start a fourth.
  for (const s of await deps.store.findAwaiting(50)) {
    try {
      const task = s.lastTaskId ? await deps.getTask(s.userId, s.lastTaskId) : null
      if (task && !isFinal(task.status) && task.status !== 'needs_review') continue
      const result = await deps.store.settle(s.id, s.lastTaskId ?? '', task ? task.status : 'gone')
      summary.settled++
      if (result.paused) summary.paused++
    } catch (err) {
      console.warn(`[task-schedule] could not record the last run of ${s.id}:`, (err as Error)?.message)
    }
  }

  const due = await deps.store.findDue(now().toISOString(), deps.limit ?? 10)
  summary.due = due.length

  await mapWithConcurrency(due, deps.concurrency ?? 3, async (item) => {
    if (now().getTime() - startedAt > budgetMs) { summary.deferred++; return }

    const claimed = await deps.store.claim(item.id, item.nextRunAt, s => decideClaim(s, now()))
    if (!claimed || !claimed.run) { summary.skipped++; return }
    const s: TaskSchedule = claimed.schedule

    // Two runs of the same schedule never overlap: the earlier one is still working.
    if (s.awaiting) {
      await deps.store.markNotStarted(s.id, 'skipped', 'Skipped one run because the task from the run before was still going.')
      summary.skipped++
      return
    }

    try {
      const task = await deps.createTask(s.userId, s.task, s.id)
      await deps.store.markStarted(s.id, task.id)
      summary.started++
    } catch (err) {
      if (err instanceof TaskError && err.code === 'limit') {
        await deps.store.markNotStarted(s.id, 'skipped', `Skipped one run: ${err.message}`).catch(() => {})
        summary.skipped++
        return
      }
      console.warn(`[task-schedule] ${s.id} could not start a task:`, (err as Error)?.message)
      const result = await deps.store.markNotStarted(s.id, 'failed', `A run could not start: ${(err as Error)?.message || 'unknown problem'}`).catch(() => ({ paused: false }))
      summary.failed++
      if (result.paused) summary.paused++
    }
  })

  return summary
}
