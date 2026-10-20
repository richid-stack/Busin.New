import { z } from 'zod'
import { parseSafeUrl, UnsafeUrlError } from '../../utils/netSafety'
import { open } from '../../utils/secretBox'
import type { McpEndpoint } from './client'
import { McpError } from './tools'
import { hostAllowed } from './allowList'
import type { ApprovedTool } from './tools'

export interface McpServer {
  id: string
  userId: string
  name: string
  url: string
  /** Header the token is sent in. */
  headerName: string
  /** Sealed with SECRETS_KEY. Never leaves the server. */
  sealedToken: string
  enabled: boolean
  approved: Record<string, ApprovedTool>
  lastError: string
  /** Set when a tool the person approved is later seen to differ or vanish. */
  driftNote: string
  createdAt: string
  updatedAt: string
}

/** What the browser is allowed to see. The token is never included. */
export interface McpServerView {
  id: string
  name: string
  url: string
  headerName: string
  hasToken: boolean
  enabled: boolean
  approved: Array<{ name: string, description: string }>
  lastError: string
  driftNote: string
}

export function viewServer(s: McpServer): McpServerView {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    headerName: s.headerName,
    hasToken: Boolean(s.sealedToken),
    enabled: s.enabled,
    approved: Object.entries(s.approved).map(([name, t]) => ({ name, description: t.description })),
    lastError: s.lastError,
    driftNote: s.driftNote
  }
}

const clean = (value: string) => value.replace(/[\u0000-\u001F\u007F]/g, '').trim()

/** Headers we set ourselves or that would change how a request is framed; a token must not go in these. */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'accept', 'transfer-encoding', 'connection', 'cookie', 'upgrade', 'mcp-session-id', 'accept-encoding'])

export { hostAllowed }

/** Checks the address only by its shape; connecting re-checks every resolved address. */
export function checkServerUrl(raw: string): string {
  let url: URL
  try {
    url = parseSafeUrl(raw)
  } catch (err) {
    throw new McpError(err instanceof UnsafeUrlError ? err.message : 'That is not a valid address.')
  }
  if (url.protocol !== 'https:') throw new McpError('MCP servers must use https.')
  if (url.search || url.hash) throw new McpError('Leave out anything after "?" or "#" in the address. Put the token in the token box instead.')
  if (!hostAllowed(url.hostname)) throw new McpError('This deployment only allows MCP servers on an approved list, and that address is not on it.')
  return url.href
}

export const serverInputSchema = z.object({
  name: z.string().transform(clean).pipe(z.string().min(1, 'Give the server a name.').max(40, 'The name can be at most 40 characters.')),
  url: z.string().transform(clean).pipe(z.string().min(8).max(500)),
  headerName: z.string().transform(clean).pipe(z.string().max(60)).optional().default('Authorization')
    .refine(h => h === '' || /^[A-Za-z0-9-]+$/.test(h), 'The header name can only use letters, digits and "-".')
    .refine(h => !FORBIDDEN_HEADERS.has(h.toLowerCase()), 'That header cannot be used for a token.')
    .transform(h => h || 'Authorization'),
  /** Empty keeps the stored token on update; on create it means no token. */
  token: z.string().max(4000).transform(t => t.replace(/[\u0000-\u001F\u007F]/g, '').trim()).optional().default('')
})

export type McpServerInput = z.infer<typeof serverInputSchema>

/** The request details for a stored server: its address and the signed-in header, decrypted for this call only. */
export function endpointFor(server: Pick<McpServer, 'url' | 'headerName' | 'sealedToken'>): McpEndpoint {
  const headers: Record<string, string> = {}
  if (server.sealedToken) {
    const token = open(server.sealedToken, 'mcp-token')
    headers[server.headerName] = server.headerName.toLowerCase() === 'authorization' && !/^(bearer|basic)\s/i.test(token) ? `Bearer ${token}` : token
  }
  return { url: server.url, headers }
}

/** A different token or header may reach different tools under the same names, so existing approvals are switched off. */
export function revokeOnSignInChange(server: Pick<McpServer, 'headerName' | 'approved'>, patch: { sealedToken?: string, headerName?: string }): { approved?: Record<string, ApprovedTool>, driftNote?: string } {
  const changed = patch.sealedToken !== undefined || (patch.headerName !== undefined && patch.headerName !== server.headerName)
  if (!changed || !Object.keys(server.approved).length) return {}
  return { approved: {}, driftNote: 'The sign-in changed, so the approved tools were switched off. Review the tools and approve them again.' }
}
