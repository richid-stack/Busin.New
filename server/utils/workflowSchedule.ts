import { HTTPError } from 'nitro'
import { assertScheduleCap, planScheduleUpdate } from '../services/schedule/plan'
import { ScheduleError } from '../services/schedule/cron'
import type { ScheduleFields } from '../services/schedule/cron'
import { getUserWorkflows } from './firebase'

type Saved = { status?: string, nodes?: any[], scheduleNextRunAt?: string | null }

/**
 * Works out the schedule fields to store when a workflow is created or changed. Returns null when
 * the schedule is untouched. A schedule that cannot be used, or one too many scheduled workflows,
 * turns into a 400 with a message the editor can show.
 */
export async function scheduleFieldsForSave(
  userId: string,
  selfId: string | undefined,
  existing: Saved | null,
  next: { status?: string, nodes?: any[] }
): Promise<ScheduleFields | null> {
  try {
    const fields = planScheduleUpdate(existing, next, new Date())
    if (fields?.scheduleNextRunAt) assertScheduleCap(fields, await getUserWorkflows(userId), selfId)
    return fields
  } catch (err) {
    if (err instanceof ScheduleError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
}
