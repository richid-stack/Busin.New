import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../utils/session'
import { upsertIntegration } from '../../utils/firebase'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const body = await readValidatedBody(event, z.object({
    provider: z.enum(['gmail', 'slack', 'google_drive', 'notion', 'github']),
    name: z.string().optional(),
    account: z.string().default('Connected Account'),
    status: z.enum(['connected', 'disconnected']).default('connected'),
    config: z.record(z.string(), z.any()).optional()
  }).parse)

  const integration = await upsertIntegration(userId, {
    provider: body.provider,
    name: body.name || body.provider,
    status: body.status,
    account: body.account,
    config: body.config
  })

  return {
    success: true,
    integration
  }
})
