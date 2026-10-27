import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../utils/reefRoute'
import { getAgent } from '../../../services/agents/store'
import { ReefError } from '../../../services/reef/model'
import { projectCard } from '../../../services/reef/projects'

/** Shares one of the person's agents as a project, or publishes a new version of one already shared. */
export default reefHandler({ auth: 'required', limit: WRITE('reef-publish', 20) }, async ({ event, me, reef }) => {
  const { agentId, ...rest } = await readValidatedBody(event, z.object({ agentId: z.string().min(1).max(128), name: z.string().max(60), description: z.string().max(600).optional(), tags: z.array(z.string().max(60)).max(20).optional(), licence: z.string().max(40).optional(), readme: z.string().max(60_000).optional(), note: z.string().max(400).optional() }).parse)
  const agent = await getAgent(agentId)
  if (!agent || agent.userId !== me.id) throw new ReefError('Agent not found.', 'not_found')
  const { project, created } = await reef.projects.publish(me.id, agent, rest as any)
  return { created, project: projectCard(project) }
})
