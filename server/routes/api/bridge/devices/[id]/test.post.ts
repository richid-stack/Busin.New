import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/session'
import { enforceRateLimit } from '../../../../../utils/rateLimit'
import { BridgeError, bridgeStore, publicJob } from '../../../../../services/bridge/store'

/** Asks the computer to answer a harmless ping, to prove the connection works. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'bridge-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    return publicJob(await bridgeStore().enqueue(user.id, id, 'ping'))
  } catch (err) {
    if (err instanceof BridgeError) throw new HTTPError({ statusCode: err.code === 'not_found' ? 404 : err.code === 'limit' ? 429 : 409, statusMessage: err.message })
    throw err
  }
})
