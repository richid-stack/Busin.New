import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../utils/session'
import { enforceRateLimit } from '../../utils/rateLimit'
import { getAgent } from '../../services/agents/store'
import { publicShare, shareStore } from '../../services/reef/share'
import { shareHttpError } from '../../services/reef/http'

/** Shares an agent by link, or publishes a new version of one already shared. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'share-write', user.id, 20, 10 * 60_000)
  const { agentId } = await readValidatedBody(event, z.object({ agentId: z.string().min(1).max(128) }).parse)
  const agent = await getAgent(agentId)
  if (!agent || agent.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Agent not found' })
  try {
    return publicShare(await shareStore().publish(user.id, user.name, agent))
  } catch (err) {
    shareHttpError(err)
  }
})
