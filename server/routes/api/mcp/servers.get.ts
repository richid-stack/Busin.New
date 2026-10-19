import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { listServers } from '../../../services/mcp/store'
import { viewServer } from '../../../services/mcp/server'
import { MCP_LIMITS } from '../../../services/mcp/tools'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return {
    servers: (await listServers(user.id)).map(viewServer),
    limits: { servers: MCP_LIMITS.maxServersPerUser, approvedTotal: MCP_LIMITS.maxApprovedPerUser, approvedPerServer: MCP_LIMITS.maxApprovedPerServer }
  }
})
