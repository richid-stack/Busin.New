import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { deleteIntegration } from '../../../utils/firebase'
import { getComposioUserConnections, deleteComposioConnection } from '../../../services/composio/client'
import { composioToolkitSlug, providerFromToolkitSlug } from '../../../services/integrations/slugs'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const { provider } = await getValidatedRouterParams(event, z.object({
    provider: z.string()
  }).parse)

  // Legacy record from the old "mark as connected" flow, if any.
  await deleteIntegration(user.id, provider).catch(() => {})

  // Remove every one of this user's connections for the provider (users can have several).
  const slug = providerFromToolkitSlug(composioToolkitSlug(provider))
  const connections = (await getComposioUserConnections(user.id)).filter(c => c.toolkitSlug === slug)
  const results = await Promise.all(connections.map(c => deleteComposioConnection(user.id, c.id)))

  return { success: results.every(Boolean), provider, removed: results.filter(Boolean).length }
})
