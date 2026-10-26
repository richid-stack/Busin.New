import { defineHandler } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { MAX_AGENTS_PER_USER } from '../../../../services/agents/profile'
import { createAgent, listAgents } from '../../../../services/agents/store'
import { skills } from '../../../../services/skills/registry'
import { shareStore } from '../../../../services/reef/share'
import { shareHttpError } from '../../../../services/reef/http'

/** Makes a copy in this person's account. Groups that reach into accounts stay off unless they are listed in `allow`. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'share-install', user.id, 20, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(8).max(64) }).parse)
  const { allow } = await readValidatedBody(event, z.object({ allow: z.array(z.string().max(32)).max(20).default([]) }).parse)
  try {
    return await shareStore().install(user.id, id, allow, {
      skills: new Set(skills.map(s => s.name)),
      agentCount: async uid => (await listAgents(uid)).length,
      maxAgents: MAX_AGENTS_PER_USER,
      createAgent
    })
  } catch (err) {
    shareHttpError(err)
  }
})
