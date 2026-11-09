import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { BridgeError, bridgeLive, bridgeStore } from '../../../../services/bridge/store'

/** Disconnects a computer: its token stops working at once. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'bridge-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    await bridgeStore().revoke(user.id, id)
    bridgeLive().dropDevice(id, 'This computer was disconnected from OpenLobs.')
    return { success: true }
  } catch (err) {
    if (err instanceof BridgeError) throw new HTTPError({ statusCode: 404, statusMessage: err.message })
    throw err
  }
})
