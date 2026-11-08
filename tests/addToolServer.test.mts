import { createAddToolServerTool, addablePresets } from '../server/utils/tools/addToolServer'
import { McpConflict, McpError } from '../server/services/mcp/tools'
import { MCP_PRESETS } from '../shared/mcpCatalog'
import { getServerTrace, getRowsTrace } from '../src/utils/tool'
import { TOOL_GROUPS } from '../server/services/agents/profile'
import { CAPABILITIES } from '../server/services/tasks/registry'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// The tool is exercised end to end. Only the two things that need a network and a database are replaced: the call to the
// outside server, and the place the saved server goes. Everything else (the address check, the limits, the rules) is real.
interface Saved { userId: string, name: string, url: string, headerName: string, sealedToken: string }
let saved: Saved[] = []
let reached: Array<{ url: string, headers: Record<string, string> }> = []
let answer: () => Promise<any[]> = async () => [{ name: 'search', description: 'Search the docs', inputSchema: { type: 'object', properties: {} } }, { name: 'fetch', description: 'Read a page', inputSchema: { type: 'object', properties: {} } }]
let existing: any[] = []
let saveError: Error | null = null
const deps = {
  list: (async (endpoint: any) => { reached.push(endpoint); return await answer() }) as any,
  create: (async (userId: string, input: any) => { if (saveError) throw saveError; saved.push({ userId, ...input }); return { id: 's1', ...input } as any }) as any,
  servers: async () => existing
}
let n = 0
const fresh = () => createAddToolServerTool(`adder-${++n}`, deps)
const exec = (t: any, input: any) => (t.execute as any)(input, {})
const noKey = addablePresets()
const withKey = MCP_PRESETS.find(p => p.auth === 'key')!
const reset = () => { saved = []; reached = []; existing = []; saveError = null }

// ---- Which servers can be added ----
assert(noKey.length >= 2 && noKey.every(p => p.auth === 'none'), 'only servers that need no key can be added from chat')
assert(!noKey.some(p => p.id === withKey.id), 'a server that needs a key is not among them')

// ---- Approval: asked for the ones that get added, never for the ones that cannot be ----
const t: any = fresh()
const needs = (server: string) => t.needsApproval({ server, why: 'x' }, {})
assert(needs(noKey[0]!.name) === true && needs(noKey[0]!.id) === true, 'adding a server needs the person\'s approval, by name or by id')
assert(needs(withKey.name) === false && needs('Made Up Server') === false, 'a server that cannot be added has nothing to approve, so no card')
const schema = t.inputSchema
assert(schema.safeParse({ server: noKey[0]!.name, why: 'Look up the docs' }).success && !schema.safeParse({ server: 'x', why: '' }).success, 'the input is checked')

// ---- Adding one ----
reset()
const done: any = await exec(fresh(), { server: noKey[0]!.name, why: 'Read the docs for this job' })
assert(done.status === 'added' && done.name === noKey[0]!.name && done.toolCount === 2 && done.tools.join() === 'search,fetch', 'a server that answers is added and its tools are listed')
assert(saved.length === 1 && saved[0]!.url === noKey[0]!.url && saved[0]!.sealedToken === '' && saved[0]!.name === noKey[0]!.name, 'it is saved at the checked address, with no token')
assert(reached.length === 1 && reached[0]!.url === noKey[0]!.url && Object.keys(reached[0]!.headers).length === 0, 'it was reached first, with no sign-in header')
assert(!('approved' in saved[0]!) && /None of its 2 tools are switched on/.test(done.next) && /Integrations/.test(done.next), 'nothing is switched on, and the assistant is told to send the person to review the tools')
assert(/never instructions/.test(done.notice), 'what the outside server said about its tools is marked as data')
assert((await exec(fresh(), { server: noKey[0]!.id, why: 'By id' }) as any).status === 'added', 'it can be asked for by id as well as by name')

// ---- Many tools are shortened, not dumped ----
reset()
answer = async () => Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'x', inputSchema: { type: 'object', properties: {} } }))
const big: any = await exec(fresh(), { server: noKey[1]!.name, why: 'Many tools' })
assert(big.toolCount === 30 && big.tools.length === 12 && big.more === 18, 'a long tool list is cut to twelve names with a count of the rest')

// ---- Reach it first: a failure leaves nothing behind ----
reset()
answer = async () => { throw new McpError('The server took too long to answer.') }
const down: any = await exec(fresh(), { server: noKey[0]!.name, why: 'Try it' })
assert(down.status === 'failed' && /too long/.test(down.error) && /Nothing was added/.test(down.error) && saved.length === 0, 'if the server does not answer, nothing is saved and the reason is given')
assert(!/plain words/.test(down.error) && /plain words/.test(down.note), 'what the person reads is kept apart from the instruction to the assistant')
answer = async () => []
const empty: any = await exec(fresh(), { server: noKey[0]!.name, why: 'Try it' })
assert(empty.status === 'failed' && saved.length === 0 && /no tools/.test(empty.error), 'a server that offers no tools is not added')
answer = async () => [{ name: 'a', description: 'a', inputSchema: { type: 'object', properties: {} } }]
saveError = new McpConflict('You can connect up to 5 MCP servers. Remove one to add another.')
const full: any = await exec(fresh(), { server: noKey[0]!.name, why: 'Full' })
assert(full.status === 'failed' && /up to 5/.test(full.error) && saved.length === 0, 'at the limit, the reason is given and nothing is added')
saveError = new Error('database down')
const broke: any = await exec(fresh(), { server: noKey[0]!.name, why: 'Broken' })
assert(broke.status === 'failed' && !/database down/.test(JSON.stringify(broke)) && /Nothing was added/.test(broke.error), 'a storage failure is reported plainly without leaking the inside error')

// ---- Already added ----
reset()
answer = async () => [{ name: 'a', description: 'a', inputSchema: { type: 'object', properties: {} } }]
existing = [{ name: noKey[0]!.name, url: noKey[0]!.url, approved: {} }]
const again: any = await exec(fresh(), { server: noKey[0]!.name, why: 'Again' })
assert(again.status === 'already_added' && reached.length === 0 && saved.length === 0 && /none of its tools are switched on/.test(again.next), 'a server that is already there is not added twice, and nothing is contacted')
existing = [{ name: noKey[0]!.name, url: noKey[0]!.url, approved: { a: {}, b: {} } }]
assert(/2 of its tools are switched on/.test(((await exec(fresh(), { server: noKey[0]!.name, why: 'Again' })) as any).next), 'it says how many of its tools are on')

// ---- A key is never taken or entered here ----
reset()
const key: any = await exec(fresh(), { server: withKey.name, why: 'Needs it' })
assert(key.status === 'needs_key' && key.where === '/integrations/mcp' && /never entered in chat/.test(key.next) && saved.length === 0 && reached.length === 0, 'a server that needs a key is not added or contacted, and the person is pointed to Integrations')
const nope: any = await exec(fresh(), { server: 'Totally Unknown', why: 'Nope' })
assert(nope.status === 'unknown' && /Available without a key/.test(nope.error) && saved.length === 0, 'an unknown name is refused with what is available')

// ---- Limits ----
reset()
answer = async () => [{ name: 'a', description: 'a', inputSchema: { type: 'object', properties: {} } }]
const limited = createAddToolServerTool('add-rate-limited', deps)
let last = ''
for (let i = 0; i < 8; i++) { existing = []; const r: any = await exec(limited, { server: noKey[0]!.name, why: 'Again and again' }); last = r.status }
assert(last === 'failed', 'adding is rate limited per person')

// ---- Where it is offered ----
assert(TOOL_GROUPS.some(g => g.id === 'add_servers' && g.tools.includes('add_tool_server') && g.sensitive), 'it has its own switch in an agent\'s tool list, marked as sensitive')
const cap = CAPABILITIES.find(c => c.tool === 'add_tool_server')
assert(cap?.risk === 'act' && cap.unattended === false, 'a background task cannot add a server on its own')

// ---- What the person sees ----
const part = (output: any) => ({ type: 'tool-add_tool_server', toolCallId: 'a', state: 'output-available', input: {}, output }) as any
const trace = getServerTrace(part(done))
assert(trace.title === `Added ${noKey[0]!.name}` && trace.summary === '2 tools to review' && !trace.failed, 'the trace names what was added and how many tools wait for review')
assert(trace.rows.map(r => `${r.verb}|${r.name}`).join('~') === `Reached|${done.host}~Added|${noKey[0]!.name}~Found tools|~|search~|fetch`, 'rows read as a short label then the name, with the tools found listed under it')
assert(getServerTrace(part(big)).rows.slice(-1)[0]!.name === 'and 18 more', 'a long list ends with how many more')
assert(getServerTrace(part(down)).failed && /took too long|Nothing was added/.test(getServerTrace(part(down)).error ?? ''), 'a failure shows the reason')
assert(getServerTrace(part(key)).rows[0]!.verb === 'Needs a key' && getServerTrace(part(again)).rows[0]!.verb === 'Already added', 'a key and an existing server each read plainly')
assert(getRowsTrace(part(done)).title.startsWith('Added') && getRowsTrace({ type: 'tool-look_in_folder', output: { status: 'failed', error: 'x' } } as any).title === 'Looked in your folder', 'the shared trace picks the right reading for each tool')
