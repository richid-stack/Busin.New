import { defineHandler, HTTPError } from 'nitro'
import { getHeader, readBody } from 'nitro/h3'
import { requireDevice } from '../../../utils/bridgeAuth'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { ApiError, pollForJobs } from '../../../services/bridge/api'
import { bridgeStore } from '../../../services/bridge/store'

/**
 * The Bridge asks "anything for me?" and the answer waits up to 25 seconds if there is nothing yet. The Bridge
 * always calls out; nothing ever calls in to a person's computer. Jobs made on this server wake a waiting poll
 * at once; otherwise it looks again every 12 seconds, which keeps the database reads low.
 */
export default defineHandler(async (event) => {
  const device = await requireDevice(event)
  enforceRateLimit(event, 'bridge-poll', device.id, 30, 60_000)
  const token = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '').trim()
  try {
    return await pollForJobs(bridgeStore(), device, token, await readBody(event).catch(() => ({})))
  } catch (err) {
    if (err instanceof ApiError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
