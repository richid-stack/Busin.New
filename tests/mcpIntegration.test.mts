import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer as SdkServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { streamText, isStepCount } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { useFirebaseDbForTests } from '../server/utils/firebaseAdmin'
import { createFakeFirestore } from './fakeFirestore'
import { seal } from '../server/utils/secretBox'
import { createStreamingFetch } from '../server/services/mcp/streamFetch'
import { listMcpTools, callMcpToolChecked } from '../server/services/mcp/client'
import { buildMcpTools } from '../server/services/mcp/chatTools'
import { createServer as createStoredServer, getServer, listServers, updateServer, deleteServer, approvedCount } from '../server/services/mcp/store'
import { endpointFor } from '../server/services/mcp/server'
import { planApproval } from '../server/services/mcp/tools'
import { createAgent, getAgent, listAgents, updateAgent, deleteAgent } from '../server/services/agents/store'
import { agentInputSchema } from '../server/services/agents/profile'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
process.env.SECRETS_KEY = 'test-secrets-key-0123456789'

// ---- A standards-compliant MCP server (the official SDK, answering over server-sent events) ----
let seenAuth = ''
const calls: any[] = []
const httpServer = createServer(async (req, res) => {
  seenAuth = String(req.headers.authorization || '')
  const sdk = new SdkServer({ name: 'official', version: '1.0.0' })
  sdk.registerTool('lookup', {
    description: 'Look up a customer by email',
    inputSchema: { email: z.string().describe('The customer email') },
    annotations: { readOnlyHint: true }
  }, async ({ email }) => { calls.push(email); return { content: [{ type: 'text', text: `customer for ${email}: Ada` }] } })
  sdk.registerTool('boom', { description: 'Always fails', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'it broke' }] }))
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }) // answers as text/event-stream
  res.on('close', () => { transport.close(); sdk.close() })
  await sdk.connect(transport)
  let body = ''
  for await (const chunk of req) body += chunk
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined)
})
await new Promise<void>(r => httpServer.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`
const local = createStreamingFetch({ validateUrl: u => new URL(u) })
const endpoint = { url: base, headers: { Authorization: 'Bearer official-token' } }

const tools = await listMcpTools(endpoint, { fetchImpl: local })
assert(tools.map(t => t.name).sort().join() === 'boom,lookup', 'the official SDK server lists its tools through our client')
assert(seenAuth === 'Bearer official-token', 'the bearer token reaches a standards-compliant server')
const lookup = tools.find(t => t.name === 'lookup')!
assert(lookup.annotations?.readOnlyHint === true && (lookup.inputSchema as any).properties.email, 'its annotations and input schema come through')
const out = await callMcpToolChecked(endpoint, 'lookup', { email: 'ada@example.com' }, () => null, { fetchImpl: local })
assert(!out.isError && out.text === 'customer for ada@example.com: Ada', 'a call to it returns its text')
const bad = await callMcpToolChecked(endpoint, 'boom', {}, () => null, { fetchImpl: local })
assert(bad.isError && bad.text === 'it broke', 'its tool errors come back as errors')

// ---- Stores against an in-memory Firestore ----
const fake = createFakeFirestore()
useFirebaseDbForTests(fake)

const created = await createStoredServer('alice', { name: 'Customers', url: base, headerName: 'Authorization', sealedToken: seal('official-token', 'mcp-token') })
await createStoredServer('bob', { name: 'Bob server', url: 'https://mcp.bob.dev/mcp', headerName: 'Authorization', sealedToken: '' })
assert((await listServers('alice')).length === 1 && (await listServers('bob')).length === 1, 'each person only lists their own servers')
assert(!JSON.stringify(fake.raw('mcp_servers').get(created.id)).includes('official-token'), 'the stored document never holds the plain token')
assert(endpointFor((await getServer(created.id))!).headers.Authorization === 'Bearer official-token', 'a stored token decrypts back for a call')

const approved = planApproval(tools, ['lookup'], approvedCount(await listServers('alice'), created.id))
await updateServer(created.id, { approved, driftNote: 'x' })
const reloaded = (await getServer(created.id))!
assert(Object.keys(reloaded.approved).join() === 'lookup' && reloaded.approved.lookup!.fingerprint.length === 64 && reloaded.url === base, 'approvals are saved and read back; the address is untouched')
assert(approvedCount(await listServers('alice')) === 1 && approvedCount(await listServers('alice'), created.id) === 0, 'approved tools are counted per person')
assert((await getServer('missing')) === null, 'a missing server reads as null')

// ---- The real AI SDK tool loop with a scripted model ----
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
const finish = (reason: 'tool-calls' | 'stop') => ({ type: 'finish' as const, finishReason: { unified: reason, raw: reason }, usage })
let step = 0
const seenByModel: any[] = []
const model = new MockLanguageModelV3({
  doStream: async (options: any) => {
    seenByModel.push(options)
    step++
    const chunks: any[] = step === 1
      ? [{ type: 'stream-start' as const, warnings: [] }, { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'mcp_customers_lookup', input: JSON.stringify({ email: 'grace@example.com' }) }, finish('tool-calls')]
      : [{ type: 'stream-start' as const, warnings: [] }, { type: 'text-start' as const, id: 't' }, { type: 'text-delta' as const, id: 't', delta: 'Found Ada.' }, { type: 'text-end' as const, id: 't' }, finish('stop')]
    return { stream: simulateReadableStream({ chunks }) }
  }
})

const stored = (await listServers('alice'))
const chatTools = buildMcpTools('alice', stored, { call: (ep, name, args, allow) => callMcpToolChecked(ep, name, args, allow, { fetchImpl: local }) })
const result = streamText({ model, tools: chatTools, messages: [{ role: 'user', content: 'Who is grace@example.com?' }], stopWhen: isStepCount(5) })
const text = await result.text
const toolResults = (await result.steps).flatMap(s => s.toolResults)
assert(Object.keys(chatTools).join() === 'mcp_customers_lookup', 'only the approved tool is offered to the model')
const offered = (seenByModel[0].tools ?? []).map((t: any) => t.name)
assert(offered.join() === 'mcp_customers_lookup', 'the model is really handed just that tool')
assert(calls.includes('grace@example.com') && toolResults.length === 1, 'the model\'s tool call reached the MCP server through the real tool loop')
const output: any = toolResults[0]!.output
assert(output.status === 'ok' && output.content === 'customer for grace@example.com: Ada' && /untrusted/.test(output.notice), 'the result handed back is labelled untrusted')
assert(text === 'Found Ada.' && step === 2, 'the model then answers using the result')
assert(JSON.stringify(seenByModel[1].prompt).includes('customer for grace@example.com'), 'the second model turn sees the tool result')

// A model that sends inputs the approved schema does not allow never reaches the server.
// (Our own check, not the server's: the server here would also refuse, so we count requests it receives.)
let requests = 0
httpServer.on('request', () => { requests++ })
step = 0; calls.length = 0
const badModel = new MockLanguageModelV3({
  doStream: async () => {
    step++
    const chunks: any[] = step === 1
      ? [{ type: 'stream-start' as const, warnings: [] }, { type: 'tool-call' as const, toolCallId: 'c2', toolName: 'mcp_customers_lookup', input: JSON.stringify({ wrong: 1 }) }, finish('tool-calls')]
      : [{ type: 'stream-start' as const, warnings: [] }, { type: 'text-start' as const, id: 't' }, { type: 'text-delta' as const, id: 't', delta: 'ok' }, { type: 'text-end' as const, id: 't' }, finish('stop')]
    return { stream: simulateReadableStream({ chunks }) }
  }
})
const r2 = streamText({ model: badModel, tools: chatTools, messages: [{ role: 'user', content: 'x' }], stopWhen: isStepCount(5) })
await r2.text
const invalidResults = (await r2.steps).flatMap(s => s.content).filter((c: any) => c.type === 'tool-error')
assert(calls.length === 0 && requests === 0 && invalidResults.length === 1, 'input that breaks the approved schema is stopped by us, before any request to the server')

// Server rewrites a tool after approval: the same loop refuses to run it.
await updateServer(created.id, { approved: { lookup: { ...reloaded.approved.lookup!, fingerprint: 'f'.repeat(64) } } })
step = 0; calls.length = 0
const tamperedTools = buildMcpTools('alice', await listServers('alice'), { call: (ep, name, args, allow) => callMcpToolChecked(ep, name, args, allow, { fetchImpl: local }) })
const r3 = streamText({ model, tools: tamperedTools, messages: [{ role: 'user', content: 'Who?' }], stopWhen: isStepCount(5) })
await r3.text
assert(calls.length === 0 && (await r3.steps).flatMap(s => s.toolResults).some((t: any) => t.output.status === 'failed' && /changed since/.test(t.output.error)), 'a tool that changed since approval is refused inside the real tool loop')
assert((await getServer(created.id))!.driftNote.includes('lookup'), 'and the drift is recorded on the stored server for the person to see')

await deleteServer(created.id)
assert((await listServers('alice')).length === 0, 'deleting a server removes it')

// ---- Agents store ----
const input = agentInputSchema.parse({ name: 'Researcher', instructions: 'Find things.', tools: ['web', 'mcp'] })
const agent = await createAgent('alice', input)
await createAgent('bob', input)
assert((await listAgents('alice')).length === 1 && (await getAgent(agent.id))!.tools.join() === 'web,mcp', 'agents are saved per person, including the MCP group')
await updateAgent(agent.id, { ...input, name: 'Renamed' })
assert((await getAgent(agent.id))!.name === 'Renamed', 'an agent can be updated')
await deleteAgent(agent.id)
assert((await getAgent(agent.id)) === null, 'an agent can be deleted')

useFirebaseDbForTests(null)
httpServer.close()
httpServer.closeAllConnections?.()
