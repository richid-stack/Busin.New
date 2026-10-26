import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { requireUser } from '../../utils/session'
import { enforceRateLimit } from '../../utils/rateLimit'
import { publicSchedule, scheduleInputSchema, taskScheduleStore } from '../../services/tasks/schedules'
import { assertSafeCriteria } from '../../services/tasks/safeCriteria'
import { scheduleHttpError } from '../../services/tasks/scheduleHttp'

/** Saves a task that starts itself, on a repeating schedule or once at a set time. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-schedule-write', user.id, 30, 10 * 60_000)
  const input = await readValidatedBody(event, body => scheduleInputSchema.parse(body))
  assertSafeCriteria(input.task)
  try {
    return publicSchedule(await taskScheduleStore().create(user.id, input))
  } catch (err) {
    scheduleHttpError(err)
  }
})
