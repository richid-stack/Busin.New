import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { taskScheduleStore } from '../../../services/tasks/schedules'
import { scheduleHttpError } from '../../../services/tasks/scheduleHttp'

/** Deletes a schedule. Tasks it already started stay in the task list. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-schedule-write', user.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    await taskScheduleStore().remove(user.id, id)
    return { success: true }
  } catch (err) {
    scheduleHttpError(err)
  }
})
