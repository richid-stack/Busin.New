import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { seal, SecretBoxError } from '../../../utils/secretBox'
import { createServer } from '../../../services/mcp/store'
import { checkServerUrl, serverInputSchema, viewServer } from '../../../services/mcp/server'
import { McpConflict, McpError } from '../../../services/mcp/tools'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'mcp-write', user.id, 20, 10 * 60_000)
  const input = await readValidatedBody(event, body => serverInputSchema.parse(body))

  try {
    const url = checkServerUrl(input.url)
    const created = await createServer(user.id, {
      name: input.name,
      url,
      headerName: input.headerName,
      sealedToken: input.token ? seal(input.token, 'mcp-token') : ''
    })
    return viewServer(created)
  } catch (err) {
    if (err instanceof McpConflict) throw new HTTPError({ statusCode: 409, statusMessage: err.message })
    if (err instanceof McpError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    if (err instanceof SecretBoxError) throw new HTTPError({ statusCode: 500, statusMessage: 'Saving tokens is not set up on this server yet.' })
    throw err
  }
})
