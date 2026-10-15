import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { deleteIntegration } from '../../../utils/firebase'
import { getComposioUserConnections, deleteComposioConnection } from '../../../services/composio/client'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const { provider } = await getValidatedRouterParams(event, z.object({
    provider: z.string()
  }).parse)

  // 1. Delete from Firestore
  await deleteIntegration(userId, provider)

  // 2. Disconnect from Composio if a connection exists
  try {
    const connections = await getComposioUserConnections(userId)
    const match = connections.find(c => c.toolkitSlug === provider.toLowerCase())
    if (match) {
      await deleteComposioConnection(userId, match.id)
    }
  } catch (err) {
    console.warn(`[DeleteIntegration] Error deleting Composio connection for ${provider}:`, err)
  }

  return {
    success: true,
    provider
  }
})
