import { TOOL_GROUPS } from '../agents/profile'

/**
 * What each tool is and how far a task may trust it. This is the single place that says whether a tool
 * may run without a person watching, so a new tool cannot join a task by accident: it has to be listed
 * here (a test checks that every chat tool is).
 */
export type Risk = 'read' | 'create' | 'act'
export type Location = 'remote' | 'local' | 'cloud'

export interface Capability {
  tool: string
  label: string
  /** Where it runs. Everything today runs on the server; "local" is for the Bridge, later. */
  location: Location
  /** read: only looks. create: makes new files. act: changes something in a person's accounts or outside systems. */
  risk: Risk
  /** May a task call it with nobody watching? Anything that acts needs a person, so it is not allowed yet. */
  unattended: boolean
  timeoutMs: number
  /** How the result of using it can be checked afterwards. */
  verifiedBy: string[]
}

const cap = (tool: string, label: string, risk: Risk, timeoutMs: number, verifiedBy: string[]): Capability =>
  ({ tool, label, location: 'remote', risk, unattended: risk !== 'act', timeoutMs, verifiedBy })

export const CAPABILITIES: Capability[] = [
  cap('web_search', 'Search the web', 'read', 30_000, ['sources']),
  cap('web_fetch', 'Read a web page', 'read', 40_000, ['sources']),
  cap('read_document', 'Read an attached file', 'read', 30_000, []),
  cap('create_document', 'Create a Word or PDF file', 'create', 60_000, ['file']),
  cap('create_spreadsheet', 'Create an Excel file', 'create', 60_000, ['file']),
  cap('create_presentation', 'Create a PowerPoint file', 'create', 60_000, ['file']),
  cap('inspect_design', 'Look at a page or picture', 'read', 70_000, ['visual']),
  // Changes files on a person's own computer (always into a new copy), so it needs a person present for now.
  { tool: 'computer_excel', label: 'Work on spreadsheets on your computer', location: 'local', risk: 'act', unattended: false, timeoutMs: 130_000, verifiedBy: ['file'] },
  cap('chart', 'Draw a chart', 'read', 10_000, []),
  cap('plan', 'Outline a plan', 'read', 10_000, []),
  cap('weather', 'Check the weather', 'read', 15_000, []),
  cap('calculator', 'Calculate', 'read', 5_000, []),
  cap('task_propose', 'Offer a background task', 'act', 5_000, []),
  cap('remember', 'Save a memory', 'act', 10_000, []),
  cap('forget_memory', 'Forget a memory', 'act', 10_000, []),
  cap('integration_status', 'Check connected apps', 'read', 15_000, []),
  cap('integration_execute', 'Act in a connected app', 'act', 60_000, []),
  cap('workflow_create', 'Create a workflow', 'act', 30_000, []),
  cap('workflow_run', 'Run a workflow', 'act', 120_000, [])
]

const byTool = new Map(CAPABILITIES.map(c => [c.tool, c]))
export const capabilityOf = (tool: string) => byTool.get(tool)

/** The tool names a task with these groups may use: in the groups, listed here, and allowed to run unattended. */
export function allowedToolNames(groups: string[]): string[] {
  return TOOL_GROUPS.filter(g => groups.includes(g.id)).flatMap(g => g.tools).filter(t => capabilityOf(t)?.unattended === true)
}

/** Tools in a task's groups that were left out, and why, so the person is told rather than surprised. */
export function withheldTools(groups: string[]): Array<{ tool: string, reason: string }> {
  return TOOL_GROUPS.filter(g => groups.includes(g.id)).flatMap(g => g.tools).flatMap((t) => {
    const c = capabilityOf(t)
    return !c ? [{ tool: t, reason: 'not registered' }] : !c.unattended ? [{ tool: t, reason: 'it changes things in your accounts, which needs you present' }] : []
  })
}
