import { HTTPError, defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { taskScheduleStore } from '../../../../services/tasks/schedules'
import { publicTask, taskStore } from '../../../../services/tasks/store'
import { processQueue } from '../../../../services/tasks/run'
import { scheduleHttpError } from '../../../../services/tasks/scheduleHttp'

/** Starts the saved task now, without waiting for its time and without changing the schedule. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-create', user.id, 20, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    const schedule = await taskScheduleStore().get(user.id, id)
    if (!schedule) throw new HTTPError({ statusCode: 404, statusMessage: 'Schedule not found.' })
    if (schedule.awaiting) throw new HTTPError({ statusCode: 409, statusMessage: 'The task from the last run is still going. Wait for it to finish.' })
    const task = await taskStore().create(user.id, schedule.task, { scheduleId: schedule.id })
    await taskScheduleStore().markStarted(schedule.id, task.id)
    void processQueue({ maxTasks: 1 }).catch(err => console.warn('[task] immediate start failed:', err?.message))
    return publicTask(task)
  } catch (err) {
    if (err instanceof HTTPError) throw err
    scheduleHttpError(err)
  }
})
