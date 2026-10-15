import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody, getRequestURL } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { createComposioConnectionLink, isComposioConfigured } from '../../../services/composio/client'
import { ALL_INTEGRATIONS_CATALOG } from '../../../services/integrations/registry'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const body = await readValidatedBody(event, z.object({
    provider: z.string().min(1),
    callbackUrl: z.string().optional()
  }).parse)

  const definition = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === body.provider)
  if (!definition) {
    throw new HTTPError({ statusCode: 400, statusMessage: `Unsupported integration provider: ${body.provider}` })
  }

  if (!isComposioConfigured()) {
    throw new HTTPError({
      statusCode: 503,
      statusMessage: 'Integrations are not configured on this server (COMPOSIO_API_KEY is missing).'
    })
  }

  // Only ever send the user back to this app after authorizing.
  let callbackUrl: string | undefined
  if (body.callbackUrl) {
    try {
      const target = new URL(body.callbackUrl, getRequestURL(event).origin)
      if (target.origin === getRequestURL(event).origin) callbackUrl = target.href
    } catch { /* ignore malformed callback */ }
  }

  try {
    const link = await createComposioConnectionLink(user.id, body.provider, callbackUrl)
    return {
      success: true,
      provider: body.provider,
      connected: false,
      redirectUrl: link.redirectUrl,
      connectionRequestId: link.connectionRequestId,
      message: `Authorize ${definition.name} to finish connecting.`
    }
  } catch (err: any) {
    console.warn(`[ConnectAPI] Could not create connection link for ${body.provider}:`, err?.message)
    throw new HTTPError({ statusCode: 502, statusMessage: `Could not start the ${definition.name} connection: ${err?.message || 'unknown error'}` })
  }
})
