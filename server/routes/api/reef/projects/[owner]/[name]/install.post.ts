import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../../utils/reefRoute'
import { MAX_AGENTS_PER_USER } from '../../../../../../services/agents/profile'
import { createAgent, listAgents } from '../../../../../../services/agents/store'
import { skills } from '../../../../../../services/skills/registry'

/** Makes a copy in this person's account. Groups that reach into accounts stay off unless listed in `allow`. */
export default reefHandler({ auth: 'required', limit: WRITE('reef-install', 20) }, async ({ event, me, reef }) => {
  const { owner, name } = await getValidatedRouterParams(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  const { allow } = await readValidatedBody(event, z.object({ allow: z.array(z.string().max(32)).max(20).default([]) }).parse)
  return await reef.projects.install(me.id, owner, name, allow, {
    skills: new Set(skills.map(s => s.name)),
    agentCount: async uid => (await listAgents(uid)).length,
    maxAgents: MAX_AGENTS_PER_USER,
    createAgent
  })
})
