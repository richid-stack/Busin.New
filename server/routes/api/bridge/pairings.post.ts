import { defineHandler, HTTPError } from 'nitro'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { BridgeError, bridgeStore } from '../../../services/bridge/store'

/** Makes a short code the person types into the Bridge on their computer. Valid for 10 minutes, usable once. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'bridge-pairing', user.id, 10, 10 * 60_000)
  try {
    return await bridgeStore().createPairing(user.id)
  } catch (err) {
    if (err instanceof BridgeError) throw new HTTPError({ statusCode: err.code === 'limit' ? 429 : 400, statusMessage: err.message })
    throw err
  }
})
