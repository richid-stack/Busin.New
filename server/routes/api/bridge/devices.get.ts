import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { bridgeStore, publicDevice } from '../../../services/bridge/store'
import { isOnline } from '../../../services/bridge/model'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const now = new Date()
  return (await bridgeStore().listDevices(user.id)).map(d => ({ ...publicDevice(d), online: isOnline(d, now) }))
})
