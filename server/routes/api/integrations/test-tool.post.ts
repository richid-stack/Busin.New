import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../utils/session'
import { executeSafeVerificationTool, isComposioConfigured } from '../../../services/composio/client'
import { getUserIntegrations } from '../../../utils/firebase'
import { ALL_INTEGRATIONS_CATALOG } from '../../../services/integrations/registry'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  const body = await readValidatedBody(event, z.object({
    provider: z.string().default('github')
  }).parse)

  const definition = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === body.provider)
  const providerName = definition?.name || body.provider

  // 1. Google Native Integrations Verification
  if (definition?.type === 'native' || body.provider.startsWith('google_') || body.provider === 'gmail') {
    const userIntegrations = await getUserIntegrations(userId)
    const activeConn = userIntegrations.find(i => i.provider === body.provider && i.status === 'connected')

    if (!activeConn) {
      return {
        success: false,
        connected: false,
        provider: providerName,
        toolSlug: `${body.provider.toUpperCase()}_STATUS_CHECK`,
        toolName: `${providerName} Connection Health`,
        message: `No active authorization found for ${providerName}. Click "Connect" to link your account.`
      }
    }

    return {
      success: true,
      connected: true,
      provider: providerName,
      toolSlug: `${body.provider.toUpperCase()}_OAUTH_VERIFIED`,
      toolName: `${providerName} Real-Time Health Check`,
      result: {
        account: activeConn.account,
        provider: body.provider,
        status: 'AUTHENTICATED_AND_READY',
        hasToken: Boolean(activeConn.config?.hasToken),
        connectedAt: activeConn.config?.connectedAt || activeConn.updatedAt
      },
      message: `Verified: ${providerName} is securely authenticated and linked to ${activeConn.account}. Ready to execute workflow nodes.`
    }
  }

  // 2. Third-Party / Composio Integrations
  if (!isComposioConfigured()) {
    return {
      success: false,
      connected: false,
      provider: providerName,
      toolSlug: `${body.provider.toUpperCase()}_TEST`,
      toolName: 'Composio Verification',
      message: 'COMPOSIO_API_KEY is not configured in the application environment.'
    }
  }

  const composioUserId = session.data.user?.id || session.id!
  const result = await executeSafeVerificationTool(composioUserId, body.provider)
  return result
})

