import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getConnector } from '../../../services/connectors/definitions'
import { cleanCredentials, defaultDb, saveCredentials } from '../../../services/connectors/store'
import { verifyKey } from '../../../services/connectors/execute'
import { ConnectorError } from '../../../services/connectors/runtime'
import { SecretBoxError } from '../../../utils/secretBox'

/** Saves the person's own key for a connector. The key is checked with a harmless read, sealed, and never sent back. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'connector-save', user.id, 10, 10 * 60_000)
  const { provider } = await getValidatedRouterParams(event, z.object({ provider: z.string() }).parse)
  const def = getConnector(provider)
  if (!def) throw new HTTPError({ statusCode: 404, statusMessage: 'Unknown service.' })

  const body = await readBody(event)
  let creds: Record<string, string>
  try {
    creds = cleanCredentials(def, (body as any)?.credentials ?? {})
  } catch (err) {
    throw new HTTPError({ statusCode: 400, statusMessage: err instanceof ConnectorError ? err.message : 'That key was not accepted.' })
  }

  const check = await verifyKey(def, creds)
  if (check && !check.ok) throw new HTTPError({ statusCode: 400, statusMessage: check.message })

  try {
    const view = await saveCredentials(defaultDb(), user.id, def, creds)
    return { success: true, provider, ...view, verified: Boolean(check?.ok) }
  } catch (err) {
    if (err instanceof SecretBoxError) throw new HTTPError({ statusCode: 503, statusMessage: 'The server is not set up to store keys yet (SECRETS_KEY is missing).' })
    console.warn('[connectors] Could not save key:', (err as Error)?.message)
    throw new HTTPError({ statusCode: 502, statusMessage: 'Could not save the key. Try again.' })
  }
})
