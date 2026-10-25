import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { listConnections } from '../../services/models/store'
import { viewMine } from '../../services/models/view'

/** The models this person switched on, for the picker. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return { models: viewMine(await listConnections(user.id)) }
})
