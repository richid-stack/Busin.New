import { defineHandler, HTTPError } from 'nitro'
import { getHeader } from 'nitro/h3'
import { runDueWorkflows } from '../../../services/schedule/tick'
import { createFirestoreScheduleStore } from '../../../services/schedule/firestoreStore'
import { executeAndRecordRun } from '../../../utils/workflowRuns'
import { secretMatches } from '../../../utils/secretCompare'
import { defaultNotifyDeps, notifyWorkflowFailure } from '../../../services/notifications/notify'

/**
 * The timer endpoint. A Cloud Scheduler job calls it every few minutes with the shared secret, and it
 * starts every scheduled workflow whose time has come. Without a secret configured it does not exist.
 */
export default defineHandler(async (event) => {
  const expected = process.env.CRON_SECRET || ''
  if (expected.length < 16) throw new HTTPError({ statusCode: 404, statusMessage: 'Not found' })

  const bearer = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  const provided = bearer || getHeader(event, 'x-cron-secret') || ''
  if (!secretMatches(provided, expected)) throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid or missing secret' })

  return await runDueWorkflows({
    store: createFirestoreScheduleStore(),
    run: async (workflow, input) => {
      const { run } = await executeAndRecordRun(workflow as any, input, workflow.userId)
      if (run.status === 'failed') {
        const failed = (run.logs || []).find((l: any) => l?.status === 'failed')
        // An email is a courtesy: it never changes how the run is recorded.
        await notifyWorkflowFailure(defaultNotifyDeps(), {
          userId: workflow.userId,
          workflowId: workflow.id,
          workflowName: String((workflow as any).name || 'Workflow'),
          step: failed?.nodeTitle,
          error: typeof failed?.error === 'string' ? failed.error : undefined
        }).catch(err => console.warn('[notify] Workflow failure email not sent:', err?.message))
      }
      return { status: run.status }
    }
  })
})
