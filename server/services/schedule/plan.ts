import { MAX_CONSECUTIVE_FAILURES, MAX_SCHEDULED_PER_USER, ScheduleError, findScheduleNode, scheduleFieldsFor } from './cron'
import type { ScheduleFields } from './cron'

interface WorkflowLike {
  status?: string
  nodes?: Array<{ type?: string, data?: Record<string, any> }>
  scheduleNextRunAt?: string | null
}

const scheduleOf = (w: WorkflowLike) => JSON.stringify(findScheduleNode(w.nodes)?.data?.schedule ?? null)

/**
 * What to store when a workflow is saved. Returns null when nothing about the schedule changed, so
 * the editor's frequent autosaves never move a run that is already due. Throws ScheduleError when the
 * workflow is active with a schedule that cannot be used.
 */
export function planScheduleUpdate(existing: WorkflowLike | null, next: { status?: string, nodes?: WorkflowLike['nodes'] }, now: Date): ScheduleFields | null {
  if (existing && existing.status === next.status && scheduleOf(existing) === scheduleOf(next as WorkflowLike)) {
    const wasScheduled = Boolean(existing.scheduleNextRunAt)
    const shouldBeScheduled = Boolean(findScheduleNode(next.nodes)) && next.status === 'active'
    if (wasScheduled === shouldBeScheduled) return null
  }
  return scheduleFieldsFor(next, now)
}

/** Refuses to switch on another scheduled workflow once the user is at the limit. */
export function assertScheduleCap(fields: ScheduleFields | null, others: Array<{ id: string, scheduleNextRunAt?: string | null }>, selfId: string | undefined) {
  if (!fields?.scheduleNextRunAt) return
  const active = others.filter(w => w.id !== selfId && w.scheduleNextRunAt).length
  if (active >= MAX_SCHEDULED_PER_USER) {
    throw new ScheduleError(`You can have ${MAX_SCHEDULED_PER_USER} scheduled workflows running at once. Pause one to switch this on.`)
  }
}

/** What to store after a scheduled run: the failure streak, and a pause once it gets too long. */
export function outcomePatch(previousFailures: number, failed: boolean): { patch: Record<string, unknown>, paused: boolean } {
  const failures = failed ? (Number(previousFailures) || 0) + 1 : 0
  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      paused: true,
      patch: {
        scheduleFailures: failures,
        status: 'paused',
        scheduleNextRunAt: null,
        scheduleError: `Paused after ${failures} failed scheduled runs in a row. Fix the problem, then switch the workflow on again.`
      }
    }
  }
  return { paused: false, patch: { scheduleFailures: failures } }
}
