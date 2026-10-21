import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/session'
import { enforceRateLimit } from '../../../../../utils/rateLimit'
import { getServer, updateServer } from '../../../../../services/mcp/store'
import { endpointFor, viewServer } from '../../../../../services/mcp/server'
import { listMcpTools } from '../../../../../services/mcp/client'
import { McpError, detectToolDrift, fingerprintTool, toolStatus } from '../../../../../services/mcp/tools'

/** Connects to the server, lists what it offers now and says, tool by tool, whether it matches what was approved. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'mcp-refresh', user.id, 15, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const server = await getServer(id)
  if (!server || server.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Server not found' })

  try {
    const tools = await listMcpTools(endpointFor(server))
    const drift = detectToolDrift(server.approved, tools)
    const note = [
      drift.changed.length ? `Changed since you approved them: ${drift.changed.join(', ')}.` : '',
      drift.removed.length ? `No longer offered: ${drift.removed.join(', ')}.` : ''
    ].filter(Boolean).join(' ')
    await updateServer(id, { lastError: '', driftNote: note })
    return {
      server: viewServer({ ...server, lastError: '', driftNote: note }),
      tools: tools.map(t => ({
        name: t.name,
        // What the person reviews is identified by this, and approval must present it back.
        fingerprint: fingerprintTool(t),
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations ?? null,
        status: toolStatus(server.approved, t),
        approved: t.name in server.approved
      })),
      removed: drift.removed
    }
  } catch (err) {
    const message = err instanceof McpError ? err.message : 'Could not talk to the server.'
    await updateServer(id, { lastError: message }).catch(() => {})
    throw new HTTPError({ statusCode: 502, statusMessage: message })
  }
})
