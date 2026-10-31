import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { holdStore } from '../../../../services/browser/holds'
import { TaskError, publicTask, taskStore } from '../../../../services/tasks/store'
import { taskBrowserKey } from '../../../../services/tasks/taskBrowser'
import { processQueue } from '../../../../services/tasks/run'

/** The person answers a paused task: approve the step, decline it, or say they dealt with what the page needed. The task goes back in the queue. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'task-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const { decision } = await readValidatedBody(event, z.object({ decision: z.enum(['approve', 'decline', 'continue']) }).strict().parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Say whether to approve, decline or continue.' })
  })
  try {
    const task = await taskStore().resume(user.id, id, decision)
    await taskStore().addEvent(id, 'status', decision === 'approve' ? 'You approved the step. Carrying on.' : decision === 'decline' ? 'You declined the step. Carrying on without it.' : 'You dealt with the page. Carrying on.')
    // The wait is over: stop the "needs you" email and let the worker pick the task up straight away.
    await holdStore().clear(taskBrowserKey(user.id, id)).catch(() => {})
    void processQueue({ budgetMs: 100_000, maxTasks: 1 }).catch(() => {})
    return publicTask(task)
  } catch (err) {
    if (err instanceof TaskError) throw new HTTPError({ statusCode: err.code === 'not_found' ? 404 : err.code === 'invalid' ? 400 : 409, statusMessage: err.message })
    throw err
  }
})
