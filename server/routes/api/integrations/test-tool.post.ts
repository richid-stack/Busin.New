import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getActiveComposioConnection, isComposioConfigured } from '../../../services/composio/client'
import { getCredentials, defaultDb } from '../../../services/connectors/store'
import { ALL_INTEGRATIONS_CATALOG } from '../../../services/integrations/registry'

/** Reports whether the signed-in user has a live connection for a provider. Performs no action on the provider. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const body = await readValidatedBody(event, z.object({
    provider: z.string().min(1)
  }).parse)

  const definition = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === body.provider)
  if (!definition) {
    throw new HTTPError({ statusCode: 400, statusMessage: `Unsupported integration provider: ${body.provider}` })
  }

  if (definition.type === 'custom') {
    const has = await getCredentials(defaultDb(), user.id, definition.provider).catch(() => null)
    return has
      ? { success: true, connected: true, provider: definition.name, message: `${definition.name} has a key saved.` }
      : { success: false, connected: false, provider: definition.name, message: `${definition.name} has no key yet. Paste it on the ${definition.name} page.` }
  }

  if (!isComposioConfigured()) {
    return { success: false, connected: false, provider: definition.name, message: 'COMPOSIO_API_KEY is not configured on the server.' }
  }

  const connection = await getActiveComposioConnection(user.id, body.provider)
  if (!connection) {
    return { success: false, connected: false, provider: definition.name, message: `${definition.name} is not connected. Click "Connect" to link your account.` }
  }

  return {
    success: true,
    connected: true,
    provider: definition.name,
    result: { account: connection.accountName, status: connection.status, connectionId: connection.id },
    message: `${definition.name} is connected${connection.accountName ? ` as ${connection.accountName}` : ''}.`
  }
})
