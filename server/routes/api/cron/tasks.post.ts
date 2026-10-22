import { defineHandler, HTTPError } from 'nitro'
import { getHeader } from 'nitro/h3'
import { processQueue } from '../../../services/tasks/run'
import { secretMatches } from '../../../utils/secretCompare'

/** The timer endpoint for tasks: starts waiting tasks and takes over ones whose worker stopped. Same secret as the workflow timer. */
export default defineHandler(async (event) => {
  const expected = process.env.CRON_SECRET || ''
  if (expected.length < 16) throw new HTTPError({ statusCode: 404, statusMessage: 'Not found' })
  const bearer = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  const provided = bearer || getHeader(event, 'x-cron-secret') || ''
  if (!secretMatches(provided, expected)) throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid or missing secret' })
  return await processQueue({ budgetMs: 120_000, maxTasks: 5 })
})
