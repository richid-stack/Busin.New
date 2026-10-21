import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { seal, SecretBoxError } from '../../../../utils/secretBox'
import { getServer, updateServer } from '../../../../services/mcp/store'
import { serverInputSchema, viewServer } from '../../../../services/mcp/server'

// The address cannot be changed: an approved server must not be quietly pointed somewhere else.
const updateSchema = serverInputSchema.pick({ name: true, headerName: true, token: true }).partial().extend({
  enabled: z.boolean().optional(),
  clearToken: z.boolean().optional()
}).strict()

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'mcp-write', user.id, 20, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const input = await readValidatedBody(event, body => updateSchema.parse(body))

  const server = await getServer(id)
  if (!server || server.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Server not found' })

  const patch: Parameters<typeof updateServer>[1] = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.headerName !== undefined) patch.headerName = input.headerName
  if (input.enabled !== undefined) patch.enabled = input.enabled
  try {
    if (input.clearToken) patch.sealedToken = ''
    else if (input.token) patch.sealedToken = seal(input.token, 'mcp-token')
  } catch (err) {
    if (err instanceof SecretBoxError) throw new HTTPError({ statusCode: 500, statusMessage: 'Saving tokens is not set up on this server yet.' })
    throw err
  }
  // A new token or header is a different sign-in: the person should look at the tools again.
  if (patch.sealedToken !== undefined || patch.headerName !== undefined) patch.driftNote = ''

  await updateServer(id, patch)
  return viewServer({ ...server, ...patch })
})
