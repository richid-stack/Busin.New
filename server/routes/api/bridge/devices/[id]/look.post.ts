import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/session'
import { enforceRateLimit } from '../../../../../utils/rateLimit'
import { BridgeError, bridgeStore, publicJob } from '../../../../../services/bridge/store'

/** Asks a computer to open a web page in its browser and send back a picture. Needs the computer to have allowed it. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'bridge-look', user.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    return publicJob(await bridgeStore().enqueue(user.id, id, 'browser_look', ((await readBody(event).catch(() => ({}))) ?? {}) as Record<string, unknown>))
  } catch (err) {
    if (err instanceof BridgeError) throw new HTTPError({ statusCode: err.code === 'not_found' ? 404 : err.code === 'limit' ? 429 : err.code === 'invalid' ? 400 : 409, statusMessage: err.message })
    throw err
  }
})
