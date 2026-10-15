import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { getResolvedUserIntegrations } from '../../services/integrations/registry'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  return await getResolvedUserIntegrations(userId)
})
