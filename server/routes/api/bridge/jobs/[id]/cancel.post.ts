import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/session'
import { BridgeError, bridgeStore, publicJob } from '../../../../../services/bridge/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  try {
    return publicJob(await bridgeStore().cancelJob(user.id, id))
  } catch (err) {
    if (err instanceof BridgeError) throw new HTTPError({ statusCode: err.code === 'not_found' ? 404 : 409, statusMessage: err.message })
    throw err
  }
})
