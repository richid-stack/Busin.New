import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/session'
import { enforceRateLimit } from '../../../../../utils/rateLimit'
import { approvedCount, getServer, listServers, updateServer } from '../../../../../services/mcp/store'
import { endpointFor, viewServer } from '../../../../../services/mcp/server'
import { listMcpTools } from '../../../../../services/mcp/client'
import { MCP_LIMITS, McpError, planApproval } from '../../../../../services/mcp/tools'

/**
 * The person's choice of tools. What gets stored is read from the server again here, not taken from the
 * browser, so the approval always matches what the server really offers at this moment.
 */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'mcp-refresh', user.id, 15, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const { tools } = await readValidatedBody(event, body => z.object({ tools: z.array(z.string().max(128)).max(MCP_LIMITS.maxToolsListed) }).parse(body))

  const server = await getServer(id)
  if (!server || server.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Server not found' })

  try {
    const offered = await listMcpTools(endpointFor(server))
    const others = approvedCount(await listServers(user.id), id)
    const approved = planApproval(offered, tools, others)
    await updateServer(id, { approved, lastError: '', driftNote: '' })
    return viewServer({ ...server, approved, lastError: '', driftNote: '' })
  } catch (err) {
    if (err instanceof McpError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
})
