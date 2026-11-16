import { defineHandler } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { reef } from '../../../../services/reef/reef'
import { shareHttpError } from '../../../../services/reef/http'
import { MAX_AGENTS_PER_USER } from '../../../../services/agents/profile'
import { createAgent, listAgents } from '../../../../services/agents/store'
import { skills } from '../../../../services/skills/registry'
import { workspaceStore } from '../../../../services/workspaces/store'
import { workspaceRoute } from '../../../../utils/workspaceRoute'

/**
 * Adds a project from the Reef to a workspace: its README becomes a file and its agent is installed
 * and becomes the workspace's default agent. Tool groups that reach into accounts stay off.
 */
export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-import', user.id, 15, 10 * 60_000)
  const params = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const { owner, name } = await readValidatedBody(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  const store = workspaceStore()
  await store.owned(user.id, params.id)
  try {
    const detail = await reef().projects.detail(owner, name, user.id)
    const fileName = `${detail.name} README.md`
    // Everything that can be refused is checked before anything is created, so a refusal leaves nothing behind.
    if (detail.readme) await store.assertRoom(user.id, params.id, fileName, detail.readme.length)
    const { agent } = await reef().projects.install(user.id, owner, name, [], {
      skills: new Set(skills.map(s => s.name)),
      agentCount: async uid => (await listAgents(uid)).length,
      maxAgents: MAX_AGENTS_PER_USER,
      createAgent
    })
    const file = detail.readme ? await store.addFile(user.id, params.id, { name: fileName, text: detail.readme }, 'reef', `${owner}/${name}`) : null
    const workspace = await store.update(user.id, params.id, { agentId: agent.id })
    return { workspace, file, agent: { id: agent.id, name: agent.name } }
  } catch (err) {
    shareHttpError(err)
  }
}))
