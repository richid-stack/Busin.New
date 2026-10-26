import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { publicSchedule, taskScheduleStore } from '../../../../services/tasks/schedules'
import { scheduleHttpError } from '../../../../services/tasks/scheduleHttp'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-schedule-write', user.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    return publicSchedule(await taskScheduleStore().setEnabled(user.id, id, true))
  } catch (err) {
    scheduleHttpError(err)
  }
})
