import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { listAgents } from '../../services/agents/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return await listAgents(user.id)
})
