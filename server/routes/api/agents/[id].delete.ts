import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { deleteAgent, getAgent } from '../../../services/agents/store'
import { workspaceStore } from '../../../services/workspaces/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'agent-write', user.id, 30, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)

  const existing = await getAgent(id)
  if (!existing || existing.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Agent not found' })

  await deleteAgent(id)
  // A workspace that used this agent goes back to the standard assistant.
  await workspaceStore().forgetAgent(user.id, id).catch(() => {})
  return { success: true }
})
