import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { BridgeError, bridgeStore, publicDevice, publicJob } from '../../../../services/bridge/store'
import { isOnline } from '../../../../services/bridge/model'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const store = bridgeStore()
  try {
    const device = await store.getDevice(user.id, id)
    if (device.revokedAt) throw new BridgeError('Computer not found.', 'not_found')
    return { device: { ...publicDevice(device), online: isOnline(device, new Date()) }, events: await store.events(user.id, id), jobs: (await store.listJobs(user.id, id)).map(publicJob) }
  } catch (err) {
    if (err instanceof BridgeError) throw new HTTPError({ statusCode: 404, statusMessage: err.message })
    throw err
  }
})
