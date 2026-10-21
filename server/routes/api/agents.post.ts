import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { requireUser } from '../../utils/session'
import { enforceRateLimit } from '../../utils/rateLimit'
import { MAX_AGENTS_PER_USER, agentInputSchema } from '../../services/agents/profile'
import { createAgent, listAgents } from '../../services/agents/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'agent-write', user.id, 30, 10 * 60_000)

  const input = await readValidatedBody(event, body => agentInputSchema.parse(body))

  if ((await listAgents(user.id)).length >= MAX_AGENTS_PER_USER) {
    throw new HTTPError({ statusCode: 409, statusMessage: `You can keep up to ${MAX_AGENTS_PER_USER} agents. Delete one to add another.` })
  }
  return await createAgent(user.id, input)
})
