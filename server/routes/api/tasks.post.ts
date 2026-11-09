import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { requireUser } from '../../utils/session'
import { enforceRateLimit } from '../../utils/rateLimit'
import { taskInputSchema } from '../../services/tasks/model'
import { TaskError, publicTask, taskStore } from '../../services/tasks/store'
import { processQueue } from '../../services/tasks/run'
import { assertSafeCriteria } from '../../services/tasks/safeCriteria'

/** Creates a task and starts working on it in the background. The page follows its progress. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-create', user.id, 20, 10 * 60_000)
  const input = await readValidatedBody(event, body => taskInputSchema.parse(body))

  // A web address to look at must be a public one; say so now, not after the task has run.
  assertSafeCriteria(input)

  try {
    const task = await taskStore().create(user.id, input)
    // Best effort: if this server stops before it finishes, the timer endpoint picks the task up.
    void processQueue({ maxTasks: 1 }).catch(err => console.warn('[task] immediate start failed:', err?.message))
    return publicTask(task)
  } catch (err) {
    if (err instanceof TaskError) throw new HTTPError({ statusCode: err.code === 'limit' ? 429 : 400, statusMessage: err.message })
    throw err
  }
})
