import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { TaskError, taskStore } from '../../../services/tasks/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    await taskStore().remove(user.id, id)
    return { success: true }
  } catch (err) {
    if (err instanceof TaskError) throw new HTTPError({ statusCode: err.code === 'not_found' ? 404 : 409, statusMessage: err.message })
    throw err
  }
})
