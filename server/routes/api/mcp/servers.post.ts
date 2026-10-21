import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { seal, SecretBoxError } from '../../../utils/secretBox'
import { createServer, listServers } from '../../../services/mcp/store'
import { checkServerUrl, serverInputSchema, viewServer } from '../../../services/mcp/server'
import { MCP_LIMITS, McpError } from '../../../services/mcp/tools'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'mcp-write', user.id, 20, 10 * 60_000)
  const input = await readValidatedBody(event, body => serverInputSchema.parse(body))

  try {
    const url = checkServerUrl(input.url)
    const existing = await listServers(user.id)
    if (existing.length >= MCP_LIMITS.maxServersPerUser) {
      throw new HTTPError({ statusCode: 409, statusMessage: `You can connect up to ${MCP_LIMITS.maxServersPerUser} MCP servers. Remove one to add another.` })
    }
    if (existing.some(s => s.url === url)) throw new HTTPError({ statusCode: 409, statusMessage: 'That server is already connected.' })
    const created = await createServer(user.id, {
      name: input.name,
      url,
      headerName: input.headerName,
      sealedToken: input.token ? seal(input.token, 'mcp-token') : ''
    })
    return viewServer(created)
  } catch (err) {
    if (err instanceof McpError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    if (err instanceof SecretBoxError) throw new HTTPError({ statusCode: 500, statusMessage: 'Saving tokens is not set up on this server yet.' })
    throw err
  }
})
