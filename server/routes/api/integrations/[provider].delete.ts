import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { deleteIntegration } from '../../../utils/firebase'
import { listComposioUserConnections, deleteComposioConnection } from '../../../services/composio/client'
import { getConnector } from '../../../services/connectors/definitions'
import { deleteCredentials, defaultDb } from '../../../services/connectors/store'
import { composioToolkitSlug, providerFromToolkitSlug } from '../../../services/integrations/slugs'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const { provider } = await getValidatedRouterParams(event, z.object({
    provider: z.string()
  }).parse)

  // Services connected with a key: removing the stored key is the whole disconnect.
  if (getConnector(provider)) {
    try {
      await deleteCredentials(defaultDb(), user.id, provider)
    } catch {
      throw new HTTPError({ statusCode: 502, statusMessage: 'Could not remove the key. Try again.' })
    }
    return { success: true, provider, removed: 1 }
  }

  // Legacy record from the old "mark as connected" flow, if any.
  await deleteIntegration(user.id, provider).catch(() => {})

  // Remove every one of this user's connections for the provider (users can have several).
  const slug = providerFromToolkitSlug(composioToolkitSlug(provider))
  let all
  try {
    all = await listComposioUserConnections(user.id)
  } catch (err) {
    // A failed lookup must not read as "nothing to disconnect".
    console.warn('[integrations] Could not list connections for disconnect:', err)
    throw new HTTPError({ statusCode: 502, statusMessage: 'Could not reach the integrations service. Nothing was disconnected; try again.' })
  }
  const connections = all.filter(c => c.toolkitSlug === slug)
  // Ownership is already established: these came from this user's own listing.
  const results = await Promise.all(connections.map(c => deleteComposioConnection(user.id, c.id, { ownershipVerified: true })))

  if (!results.every(Boolean)) {
    throw new HTTPError({ statusCode: 502, statusMessage: `Could not disconnect ${results.filter(r => !r).length} account(s). Try again.` })
  }
  return { success: true, provider, removed: results.length }
})
