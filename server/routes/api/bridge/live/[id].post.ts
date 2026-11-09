import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody } from 'nitro/h3'
import { z } from 'zod'
import { requireDevice } from '../../../../utils/bridgeAuth'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { ApiError, answerLive } from '../../../../services/bridge/api'
import { bridgeLive } from '../../../../services/bridge/store'

/** The Bridge answers a live browser step (a picture of the page, the result of a click). */
export default defineHandler(async (event) => {
  const device = await requireDevice(event)
  enforceRateLimit(event, 'bridge-live', device.id, 600, 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    return answerLive(bridgeLive(), device, id, await readBody(event).catch(() => null))
  } catch (err) {
    if (err instanceof ApiError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
