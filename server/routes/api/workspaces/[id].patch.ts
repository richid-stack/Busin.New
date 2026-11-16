import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getAgent } from '../../../services/agents/store'
import { workspaceStore } from '../../../services/workspaces/store'
import { workspaceRoute } from '../../../utils/workspaceRoute'

export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const body = await readBody(event)
  // An agent is the signed-in owner's own; anything else is refused rather than quietly ignored.
  const agentId = body && typeof body === 'object' ? (body as any).agentId : undefined
  if (typeof agentId === 'string') {
    const agent = await getAgent(agentId)
    if (!agent || agent.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Agent not found' })
  }
  return await workspaceStore().update(user.id, id, body)
}))
