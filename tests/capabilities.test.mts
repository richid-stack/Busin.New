import { resolveSetup } from '../server/services/capabilities/manifest'
import type { AppInfo, SetupSources } from '../server/services/capabilities/manifest'
import { createCheckSetupTool } from '../server/utils/tools/checkSetup'
import { MCP_PRESETS } from '../shared/mcpCatalog'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const apps: AppInfo[] = [
  { provider: 'gmail', name: 'Gmail', type: 'native', status: 'connected', description: 'Read and send email.', canConnect: true, hasActions: true },
  { provider: 'notion', name: 'Notion', type: 'composio', status: 'disconnected', description: 'Notes and databases.', canConnect: true, hasActions: true },
  { provider: 'paystack', name: 'Paystack', type: 'custom', status: 'disconnected', description: 'Take card and mobile money payments.', canConnect: true, hasActions: true, getKeyUrl: 'https://dashboard.paystack.com' },
  { provider: 'linear', name: 'Linear', type: 'composio', status: 'disconnected', description: 'Issues.', canConnect: false, hasActions: true },
  { provider: 'reader', name: 'Reader', type: 'composio', status: 'connected', description: 'Reads pages.', canConnect: true, hasActions: false }
]
const base = (over: Partial<SetupSources> = {}): SetupSources => ({
  apps: async () => apps,
  servers: async () => [{ name: 'My docs server', enabled: true, lastError: '' }, { name: 'Broken one', enabled: true, lastError: 'Connection refused' }, { name: 'Paused one', enabled: false, lastError: '' }],
  presets: MCP_PRESETS,
  skills: [{ name: 'code-review', description: 'Review code for bugs.' }],
  computers: async () => [],
  ...over
})
const one = async (ask: string, over: Partial<SetupSources> = {}) => (await resolveSetup([ask], base(over)))[0]!

const gmail = await one('gmail')
assert(gmail.kind === 'app' && gmail.state === 'ready' && gmail.risk === 'changes' && gmail.needs.length === 0, 'a connected app is ready, and labelled as able to change things')
assert((await one('Reader')).risk === 'reads', 'an app with no actions only reads')
const notion = await one('Notion workspace')
assert(notion.state === 'not_connected' && /Connect Notion in Integrations/.test(notion.next) && notion.where === '/integrations/notion', 'an unconnected app says the one step and where it happens')
const pay = await one('paystack')
assert(pay.state === 'needs_key' && /paste your key/.test(pay.next) && pay.next.includes('dashboard.paystack.com'), 'an app that needs a key says where to make it')
assert((await one('Linear')).state === 'unavailable', 'when connecting is switched off, it says so instead of asking for a sign-in')
const partial = await one('code')
assert(partial.kind !== 'skill', 'a part of a skill name does not hide the app or tool it may mean')
const skill = await one('code review')
assert(skill.kind === 'skill' && skill.state === 'ready' && skill.risk === 'guidance', 'a built-in skill is ready and is guidance only')

// tool servers
const own = await one('my docs server')
assert(own.kind === 'tool_server' && own.state === 'ready', 'a tool server the person added and switched on is ready')
const broken = await one('broken one')
assert(broken.state === 'unavailable' && /Connection refused/.test(broken.next), 'a failing tool server says why')
assert(/switched off/.test((await one('paused one')).next), 'a switched-off tool server says so')
const preset = MCP_PRESETS.find(p => p.auth === 'key')!
const pre = await one(preset.name)
assert(pre.kind === 'tool_server' && pre.state === 'needs_key' && /Integrations/.test(pre.next) && /never shown in chat/.test(pre.next) && pre.where === '/integrations/mcp', 'a known tool server needs a key that is added in Integrations, never in chat')
assert(pre.risk === (preset.access === 'changes' ? 'changes' : 'reads'), 'its risk label comes from the maker-checked catalogue')

// computers
assert((await one('my computer')).state === 'not_connected', 'no paired computer: it needs the Bridge installed')
assert((await one('excel on my laptop', { computers: async () => [{ name: 'Office PC', online: false }] })).state === 'offline', 'a paired but offline computer is reported offline')
const online = await one('my pc', { computers: async () => [{ name: 'Office PC', online: true }] })
assert(online.state === 'ready' && online.name === 'Office PC', 'an online computer is ready')
assert((await one('topcoder')).kind !== 'computer', 'a name that merely contains "pc" is not a computer')

// honesty when a source cannot be read
const down = await one('gmail', { apps: async () => { throw new Error('composio down') } })
assert(down.state === 'unknown' && !/connected/i.test(down.next.replace('connected just now', '')), 'when connections cannot be read, it does not claim anything is connected or missing')
const unknown = await one('quantum toaster')
assert(unknown.state === 'unknown' && /nothing by that name/.test(unknown.next), 'an unknown name says so')
const close = await one('send email', {})
assert(close.state === 'unknown' && /Close matches: .*Gmail/.test(close.next), 'near matches are suggested when the name is not found')

// the tool
const tool: any = createCheckSetupTool('u1', { apps: base().apps, servers: base().servers, skills: base().skills, computers: base().computers })
const out: any = await tool.execute(tool.inputSchema.parse({ needs: ['Gmail', 'gmail', 'Notion', 'my computer'] }), { toolCallId: 't', messages: [] })
assert(out.status === 'ok' && out.cards.length === 3 && out.ready === 1 && out.summary === '1 of 3 ready', 'duplicates are merged and the summary counts what is ready')
assert(out.cards[1].stateLabel === 'needs connecting' && /Do not pretend/.test(out.note), 'each card carries a plain label, and the model is told not to pretend')
assert(!JSON.stringify(out).toLowerCase().includes('token'), 'no secret material appears in the result')
assert(tool.inputSchema.safeParse({ needs: [] }).success === false && tool.inputSchema.safeParse({ needs: Array(9).fill('Gmail') }).success === false, 'between 1 and 8 things can be checked at once')
