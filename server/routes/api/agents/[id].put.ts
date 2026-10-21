import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { agentInputSchema } from '../../../services/agents/profile'
import { getAgent, updateAgent } from '../../../services/agents/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'agent-write', user.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const input = await readValidatedBody(event, body => agentInputSchema.parse(body))

  const existing = await getAgent(id)
  if (!existing || existing.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Agent not found' })

  await updateAgent(id, input)
  return { ...existing, ...input, updatedAt: new Date().toISOString() }
})
