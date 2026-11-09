import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody } from 'nitro/h3'
import { z } from 'zod'
import { requireDevice } from '../../../../../utils/bridgeAuth'
import { enforceRateLimit } from '../../../../../utils/rateLimit'
import { ApiError, uploadJobFile } from '../../../../../services/bridge/api'
import { bridgeStore } from '../../../../../services/bridge/store'
import { fileStore } from '../../../../../services/files'

/** The Bridge sends the picture it took for a browser job. */
export default defineHandler(async (event) => {
  const device = await requireDevice(event)
  enforceRateLimit(event, 'bridge-file', device.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    return await uploadJobFile(bridgeStore(), device, id, await readBody(event).catch(() => null), i => fileStore().save(i))
  } catch (err) {
    if (err instanceof ApiError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
