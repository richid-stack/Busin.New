import { createMCPClient } from '@ai-sdk/mcp'
import { createStreamingFetch } from './streamFetch'
import { MCP_LIMITS, McpError, normalizeTool } from './tools'
import type { McpToolDef } from './tools'

/** Where a user's MCP server is and how to sign in to it. */
export interface McpEndpoint {
  url: string
  headers: Record<string, string>
}

export interface McpCallOptions {
  signal?: AbortSignal
  /** Time allowed for connecting and listing; calls get their own limit from the tool wrapper. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface McpCallResult {
  isError: boolean
  text: string
  structured?: unknown
}

const describe = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  if (/not a public|UnsafeUrl|must use https/i.test(message)) return 'That address is not allowed. MCP servers must be public https addresses.'
  if (/401|403|unauthor|forbidden/i.test(message)) return 'The server refused the sign-in. Check the token.'
  if (/abort|timed? ?out|too long/i.test(message)) return 'The server took too long to answer.'
  if (/redirect/i.test(message)) return 'The server tried to redirect, which is not allowed. Use its final address.'
  return `Could not talk to the server: ${message.slice(0, 160)}`
}

async function withClient<T>(endpoint: McpEndpoint, options: McpCallOptions, run: (client: Awaited<ReturnType<typeof createMCPClient>>) => Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined
  try {
    client = await createMCPClient({
      transport: { type: 'http', url: endpoint.url, headers: endpoint.headers, redirect: 'error', fetch: options.fetchImpl ?? createStreamingFetch() },
      initializationOptions: { signal, timeout: timeoutMs },
      clientName: 'openlobs'
    })
    return await Promise.race([
      run(client),
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true }))
    ])
  } catch (err) {
    if (err instanceof McpError) throw err
    throw new McpError(describe(err))
  } finally {
    await client?.close().catch(() => {})
  }
}

/** Everything the server offers (acceptable tools only), following pagination up to a cap. */
export async function listMcpTools(endpoint: McpEndpoint, options: McpCallOptions = {}): Promise<McpToolDef[]> {
  return await withClient(endpoint, options, async (client) => {
    const tools: McpToolDef[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10 && tools.length < MCP_LIMITS.maxToolsListed; page++) {
      const res = await client.listTools(cursor ? { params: { cursor } } : undefined)
      for (const raw of res.tools) {
        const tool = normalizeTool(raw)
        if (tool && !tools.some(t => t.name === tool.name)) tools.push(tool)
      }
      cursor = res.nextCursor
      if (!cursor) break
    }
    return tools.slice(0, MCP_LIMITS.maxToolsListed)
  })
}

/** Lists the tools and runs one of them over a single connection, so the check and the call see the same server. */
export async function callMcpToolChecked(
  endpoint: McpEndpoint,
  name: string,
  args: Record<string, unknown>,
  /** Decides, from what the server offers right now, whether this exact tool may run. */
  allow: (current: McpToolDef | undefined) => string | null,
  options: McpCallOptions = {}
): Promise<McpCallResult> {
  return await withClient(endpoint, { timeoutMs: 30_000, ...options }, async (client) => {
    const listed = await client.listTools()
    const live = listed.tools.map(normalizeTool).find(t => t?.name === name) ?? undefined
    const refusal = allow(live)
    if (refusal) throw new McpError(refusal)

    const res: any = await client.callTool({ name, arguments: args })
    const parts: string[] = []
    for (const item of res.content ?? []) {
      if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text)
      else if (item?.type === 'resource' && typeof item.resource?.text === 'string') parts.push(item.resource.text)
      else if (item?.type) parts.push(`[${item.type} content not shown]`)
    }
    return { isError: Boolean(res.isError), text: parts.join('\n'), ...(res.structuredContent !== undefined ? { structured: res.structuredContent } : {}) }
  })
}
