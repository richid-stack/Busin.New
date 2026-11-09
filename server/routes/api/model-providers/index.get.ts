import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { listConnections } from '../../../services/models/store'
import { viewProviders } from '../../../services/models/view'

/** Every provider a person can connect, and which ones they have. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return { providers: viewProviders(await listConnections(user.id)) }
})
