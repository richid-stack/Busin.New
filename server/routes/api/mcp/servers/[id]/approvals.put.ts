import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/session'
import { enforceRateLimit } from '../../../../../utils/rateLimit'
import { getServer, setApprovals } from '../../../../../services/mcp/store'
import { endpointFor, viewServer } from '../../../../../services/mcp/server'
import { listMcpTools } from '../../../../../services/mcp/client'
import { MCP_LIMITS, McpConflict, McpError, planApproval } from '../../../../../services/mcp/tools'

const bodySchema = z.object({
  tools: z.array(z.object({ name: z.string().max(128), fingerprint: z.string().regex(/^[0-9a-f]{64}$/), runWithoutAsking: z.boolean().optional() })).max(MCP_LIMITS.maxToolsListed)
})

/**
 * The person's choice of tools. Each choice carries the fingerprint of the version they reviewed. The server is
 * read again here, and a tool that is different now is refused, so nothing is approved that was not shown.
 */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'mcp-refresh', user.id, 15, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const { tools } = await readValidatedBody(event, body => bodySchema.parse(body))

  const server = await getServer(id)
  if (!server || server.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Server not found' })

  try {
    const offered = await listMcpTools(endpointFor(server))
    return viewServer(await setApprovals(user.id, id, others => planApproval(offered, tools, others)))
  } catch (err) {
    if (err instanceof McpConflict) throw new HTTPError({ statusCode: 409, statusMessage: err.message })
    if (err instanceof McpError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
})
