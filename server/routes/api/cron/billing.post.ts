import { defineHandler, HTTPError } from 'nitro'
import { getHeader } from 'nitro/h3'
import { secretMatches } from '../../../utils/secretCompare'
import { defaultNotifyDeps, processRenewalReminders } from '../../../services/notifications/notify'

/** Run once a day by Cloud Scheduler: emails people whose Pro plan ends soon. Same secret as the workflow timer. */
export default defineHandler(async (event) => {
  const expected = process.env.CRON_SECRET || ''
  if (expected.length < 16) throw new HTTPError({ statusCode: 404, statusMessage: 'Not found' })
  const bearer = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  if (!secretMatches(bearer || getHeader(event, 'x-cron-secret') || '', expected)) throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid or missing secret' })
  return await processRenewalReminders(defaultNotifyDeps())
})
