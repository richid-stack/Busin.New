import { defineHandler } from 'nitro'
import { requireDevice } from '../../../utils/bridgeAuth'
import { bridgeStore } from '../../../services/bridge/store'

/** The Bridge asks OpenLobs to forget its computer (the person ran "bridge disconnect"). */
export default defineHandler(async (event) => {
  const device = await requireDevice(event)
  await bridgeStore().revoke(device.userId, device.id)
  return { success: true }
})
