import { defineHandler, HTTPError } from 'nitro'
import { requireUser } from '../../utils/session'
import { getResolvedUserIntegrations } from '../../services/integrations/registry'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  try {
    return await getResolvedUserIntegrations(user.id)
  } catch (err) {
    console.warn('[integrations] Could not load connections:', err)
    throw new HTTPError({ statusCode: 502, statusMessage: 'Could not reach the integrations service. Try again in a moment.' })
  }
})
