import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { listToolkitActions } from '../../../../services/integrations/toolkitActions'
import { getConnector } from '../../../../services/connectors/definitions'

/** What an app can really do: its full action list, each marked as reading or changing. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'integration-actions', user.id, 30, 10 * 60_000)
  const { provider } = await getValidatedRouterParams(event, z.object({ provider: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/) }).parse)

  // Services connected with a key list their own declared actions.
  const connector = getConnector(provider)
  if (connector) {
    return {
      source: 'declared',
      total: connector.actions.length,
      actions: connector.actions.map(a => ({ slug: a.id, name: a.name, description: a.description, effect: a.effect === 'read' ? 'read' : 'change' }))
    }
  }
  const listed = await listToolkitActions(provider)
  if (!listed) throw new HTTPError({ statusCode: 503, statusMessage: 'The full list is not available right now.' })
  return { source: 'composio', ...listed }
})
