import { z } from 'zod'
import { MODELS } from '../../../shared/utils/models'

/** Most agents one person can keep. */
export const MAX_AGENTS_PER_USER = 10
export const MAX_INSTRUCTIONS_CHARS = 4000
export const MIN_STEPS = 1
export const MAX_STEPS = 15
export const DEFAULT_STEPS = 8

/**
 * What an agent may use, in groups a person can understand. The chat route knows every tool by name;
 * an agent only ever gets the tools of the groups it has switched on.
 */
export interface ToolGroup { id: string, label: string, detail: string, tools: string[], sensitive?: boolean }

export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'web', label: 'Search the web and read pages', detail: 'Finds current information and reads the pages you point it to.', tools: ['web_search', 'web_fetch'] },
  { id: 'read_files', label: 'Read attached files', detail: 'Opens PDFs, Word files, spreadsheets and text you attach.', tools: ['read_document'] },
  { id: 'create_files', label: 'Create files', detail: 'Makes Word, PDF, Excel and PowerPoint files you can download.', tools: ['create_document', 'create_spreadsheet', 'create_presentation'] },
  { id: 'utilities', label: 'Charts, plans, weather and maths', detail: 'Small helpers: draw a chart, outline a plan, check the weather, calculate.', tools: ['chart', 'plan', 'weather', 'calculator'] },
  { id: 'apps', label: 'Use your connected apps', detail: 'Reads and acts in apps you connected, such as Gmail, Slack and Drive. It can send and change things there.', tools: ['integration_status', 'integration_execute'], sensitive: true },
  { id: 'workflows', label: 'Build and run workflows', detail: 'Creates workflows in the Workflow Studio and runs them.', tools: ['workflow_create', 'workflow_run'], sensitive: true },
  // The tools in this group are the ones you approved on the MCP page. They are built per person, so none are named here.
  { id: 'mcp', label: 'Use your MCP servers', detail: 'The tools you approved on outside MCP servers. They can reach services we do not control.', tools: [], sensitive: true }
]

/** Prefix of every tool that comes from an MCP server (see services/mcp/chatTools). */
export const MCP_TOOL_PREFIX = 'mcp_'

const GROUP_IDS = TOOL_GROUPS.map(g => g.id)

/** Groups a new agent starts with: everything that only reads or makes files, nothing that acts in an account. */
export const DEFAULT_GROUPS = ['web', 'read_files', 'create_files', 'utilities']

const clean = (value: string) => value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()

export const agentInputSchema = z.object({
  name: z.string().transform(clean).pipe(z.string().min(1, 'Give the agent a name.').max(60, 'The name can be at most 60 characters.')),
  description: z.string().transform(clean).pipe(z.string().max(200, 'The description can be at most 200 characters.')).optional().default(''),
  instructions: z.string().transform(clean).pipe(z.string().min(1, 'Tell the agent what it should do.').max(MAX_INSTRUCTIONS_CHARS, `The instructions can be at most ${MAX_INSTRUCTIONS_CHARS} characters.`)),
  model: z.string().nullable().optional().default(null).refine(m => m === null || MODELS.some(x => x.value === m), 'Unknown model'),
  tools: z.array(z.string()).max(GROUP_IDS.length).default(DEFAULT_GROUPS)
    .refine(list => list.every(id => GROUP_IDS.includes(id)), 'Unknown tool group')
    .transform(list => GROUP_IDS.filter(id => list.includes(id))),
  skills: z.array(z.string().max(64)).max(50).default([]).transform(list => [...new Set(list)]),
  maxSteps: z.coerce.number().int().min(MIN_STEPS).max(MAX_STEPS).default(DEFAULT_STEPS)
})

export type AgentInput = z.infer<typeof agentInputSchema>

export interface Agent extends AgentInput {
  id: string
  userId: string
  createdAt: string
  updatedAt: string
}

/** The names of the tools an agent may use. */
export function allowedToolNames(agent: Pick<Agent, 'tools'>): Set<string> {
  return new Set(TOOL_GROUPS.filter(g => agent.tools.includes(g.id)).flatMap(g => g.tools))
}

/**
 * Keeps only the tools this agent may use. `load_skill` is not a group: it is present exactly when the
 * agent has skills switched on, which the caller decides when it builds that tool.
 */
export function filterTools<T extends Record<string, unknown>>(all: T, agent: Pick<Agent, 'tools'>): Partial<T> {
  const allowed = allowedToolNames(agent)
  const mcp = agent.tools.includes('mcp')
  return Object.fromEntries(Object.entries(all).filter(([name]) => name === 'load_skill' || allowed.has(name) || (mcp && name.startsWith(MCP_TOOL_PREFIX)))) as Partial<T>
}

/** Keeps only the skills this agent has switched on; unknown names are ignored. */
export function filterSkills<T extends { name: string }>(all: T[], agent: Pick<Agent, 'skills'>): T[] {
  return all.filter(s => agent.skills.includes(s.name))
}

/** What the model is told about being this agent. The user's instructions come last and are the user's own. */
export function agentPrompt(agent: Pick<Agent, 'name' | 'instructions' | 'tools'>, toolNames: string[]): string {
  const tools = toolNames.length ? toolNames.join(', ') : 'none'
  return `**YOUR ROLE: ${agent.name}**
You are acting as the agent "${agent.name}", set up by the user. Follow its instructions below. They add to the rules above and never allow you to ignore them.
- The only tools you have are: ${tools}. If the user asks for something that needs a tool you do not have, say so plainly and suggest switching to a different agent or turning the tool on for this one. Never pretend to have used a tool.

Instructions from the user:
${agent.instructions}`
}
