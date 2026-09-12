import { defineHandler } from 'nitro'
import { useUserSession } from '../../utils/session'
import { getResolvedUserIntegrations } from '../../services/integrations/registry'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  return await getResolvedUserIntegrations(userId)
})
