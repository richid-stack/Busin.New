import { defineHandler } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { publicSchedule, scheduleInputSchema, taskScheduleStore } from '../../../services/tasks/schedules'
import { assertSafeCriteria } from '../../../services/tasks/safeCriteria'
import { scheduleHttpError } from '../../../services/tasks/scheduleHttp'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-schedule-write', user.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const input = await readValidatedBody(event, body => scheduleInputSchema.parse(body))
  assertSafeCriteria(input.task)
  try {
    return publicSchedule(await taskScheduleStore().update(user.id, id, input))
  } catch (err) {
    scheduleHttpError(err)
  }
})
