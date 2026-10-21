import { defineHandler, HTTPError } from 'nitro'
import { getHeader } from 'nitro/h3'
import { runDueWorkflows } from '../../../services/schedule/tick'
import { createFirestoreScheduleStore } from '../../../services/schedule/firestoreStore'
import { executeAndRecordRun } from '../../../utils/workflowRuns'
import { secretMatches } from '../../../utils/secretCompare'

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
      return { status: run.status }
    }
  })
})
