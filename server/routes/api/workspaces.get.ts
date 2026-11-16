import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { workspaceStore } from '../../services/workspaces/store'
import { MAX_WORKSPACES } from '../../services/workspaces/profile'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const workspaces = await workspaceStore().list(user.id)
  return { workspaces, max: MAX_WORKSPACES }
})
