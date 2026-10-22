import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { publicTask, taskStore } from '../../../services/tasks/store'

/** One task with its log, for the progress page. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const store = taskStore()
  const task = await store.get(user.id, id)
  if (!task) throw new HTTPError({ statusCode: 404, statusMessage: 'Task not found' })
  return { task: publicTask(task), events: await store.events(user.id, id) }
})
