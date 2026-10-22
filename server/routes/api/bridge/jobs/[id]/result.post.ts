import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody } from 'nitro/h3'
import { z } from 'zod'
import { requireDevice } from '../../../../../utils/bridgeAuth'
import { enforceRateLimit } from '../../../../../utils/rateLimit'
import { ApiError, reportJob } from '../../../../../services/bridge/api'
import { bridgeStore } from '../../../../../services/bridge/store'

/** The Bridge reports how a job went. */
export default defineHandler(async (event) => {
  const device = await requireDevice(event)
  enforceRateLimit(event, 'bridge-result', device.id, 60, 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    return await reportJob(bridgeStore(), device, id, await readBody(event).catch(() => null))
  } catch (err) {
    if (err instanceof ApiError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
