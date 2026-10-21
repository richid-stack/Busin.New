import { MAX_CONSECUTIVE_FAILURES, ScheduleError, findScheduleNode, nextRun } from './cron'
import { mapWithConcurrency } from '../../utils/workflowNodes'

/** The part of a workflow the timer needs. */
export interface DueWorkflow {
  id: string
  userId: string
  status: string
  nodes: any[]
  scheduleNextRunAt?: string | null
  scheduleFailures?: number
}

export interface ScheduleStore {
  /** Workflows whose next run time has passed, oldest first. */
  findDue(nowIso: string, limit: number): Promise<Array<{ id: string, nextRunAt: string }>>
  /**
   * Atomically claims one due workflow: `decide` sees it as it is stored right now and returns what to
   * write; when it was already claimed by another tick (its run time no longer matches) this returns null.
   */
  claim(id: string, expectedNextRunAt: string, decide: (workflow: DueWorkflow) => { patch: Record<string, unknown>, run: boolean }): Promise<{ workflow: DueWorkflow, run: boolean } | null>
  /** Records how a scheduled run ended. Returns what it changed, for reporting. */
  recordOutcome(id: string, failed: boolean): Promise<{ paused: boolean }>
}

export interface TickSummary {
  due: number
  started: number
  skipped: number
  failed: number
  paused: number
  deferred: number
}

export interface TickOptions {
  store: ScheduleStore
  /** Starts a workflow and reports how the run ended. */
  run: (workflow: DueWorkflow, input: Record<string, any>) => Promise<{ status: string }>
  now?: () => Date
  /** Most workflows handled in one call. */
  limit?: number
  /** After this long no new workflow is started; the rest stay due for the next call. */
  budgetMs?: number
  concurrency?: number
}

/** Starts every workflow whose scheduled time has come. Safe to call from several places at once. */
export async function runDueWorkflows(options: TickOptions): Promise<TickSummary> {
  const now = options.now ?? (() => new Date())
  const startedAt = now().getTime()
  const budgetMs = options.budgetMs ?? 90_000
  const summary: TickSummary = { due: 0, started: 0, skipped: 0, failed: 0, paused: 0, deferred: 0 }

  const due = await options.store.findDue(now().toISOString(), options.limit ?? 10)
  summary.due = due.length

  await mapWithConcurrency(due, options.concurrency ?? 3, async (item) => {
    if (now().getTime() - startedAt > budgetMs) { summary.deferred++; return }

    const claimed = await options.store.claim(item.id, item.nextRunAt, (workflow) => {
      const nowIso = now().toISOString()
      const node = findScheduleNode(workflow.nodes)
      if (workflow.status !== 'active' || !node) return { patch: { scheduleNextRunAt: null }, run: false }
      try {
        // Next run is counted from now, so a long outage causes one run, not a burst of catch-up runs.
        return { patch: { scheduleNextRunAt: nextRun(node.data?.schedule ?? {}, now()).toISOString(), scheduleLastRunAt: nowIso }, run: true }
      } catch (err) {
        const message = err instanceof ScheduleError ? err.message : 'The schedule could not be read.'
        return { patch: { scheduleNextRunAt: null, scheduleError: message }, run: false }
      }
    })
    if (!claimed || !claimed.run) { summary.skipped++; return }

    const { workflow } = claimed
    const node = findScheduleNode(workflow.nodes)!
    const schedule = node.data?.schedule ?? {}
    summary.started++
    try {
      const outcome = await options.run(workflow, {
        [node.id]: { event: 'schedule', scheduledFor: item.nextRunAt, firedAt: now().toISOString(), cron: schedule.cron, timezone: schedule.timezone || 'UTC' }
      })
      // A run waiting for approval has not failed, and it has not succeeded either: leave the count alone.
      if (outcome.status === 'waiting_approval') return
      const result = await options.store.recordOutcome(workflow.id, outcome.status === 'failed')
      if (outcome.status === 'failed') summary.failed++
      if (result.paused) summary.paused++
    } catch (err) {
      console.error(`[schedule] run of ${workflow.id} could not be recorded:`, err)
      summary.failed++
      const result = await options.store.recordOutcome(workflow.id, true).catch(() => ({ paused: false }))
      if (result.paused) summary.paused++
    }
  })

  return summary
}

export { MAX_CONSECUTIVE_FAILURES }
