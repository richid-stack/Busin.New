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
  cap('fetch_file', 'Save a file from a link', 'create', 40_000, ['file']),
  cap('view_image', 'Look at an image', 'read', 40_000, ['visual']),
  cap('look_at_page', 'Look at a web page', 'read', 40_000, ['visual']),
  cap('design_tokens', 'Read a page\'s design', 'read', 20_000, []),
  cap('find_icons', 'Find icons', 'read', 10_000, []),
  cap('find_fonts', 'Find fonts', 'read', 10_000, []),
  cap('github_read', 'Read a GitHub project', 'read', 30_000, []),
  cap('community_search', 'Search the Reef', 'read', 10_000, []),
  cap('check_setup', 'Check what is connected', 'read', 20_000, []),
  cap('find_skill', 'Look for a skill', 'read', 30_000, []),
  // Opening a skill from the internet needs the person to approve it, so a task may not do it alone.
  cap('load_external_skill', 'Open a skill from GitHub', 'act', 30_000, []),
  { tool: 'install_skill', label: 'Keep a skill', location: 'remote', risk: 'act', unattended: false, timeoutMs: 30_000, verifiedBy: [] },
  cap('create_document', 'Create a Word or PDF file', 'create', 60_000, ['file']),
  cap('create_spreadsheet', 'Create an Excel file', 'create', 60_000, ['file']),
  cap('create_presentation', 'Create a PowerPoint file', 'create', 60_000, ['file']),
  cap('create_page', 'Create a web page', 'create', 60_000, ['file']),
  // Changes a file the person has open beside the chat, so a person has to be there.
  { tool: 'edit_file', label: 'Change part of a file', location: 'remote', risk: 'act', unattended: false, timeoutMs: 40_000, verifiedBy: [] },
  // The project belongs to a chat, so a person has to be in the chat.
  { tool: 'list_files', label: 'List project files', location: 'remote', risk: 'read', unattended: false, timeoutMs: 40_000, verifiedBy: [] },
  { tool: 'read_file', label: 'Read a project file', location: 'remote', risk: 'read', unattended: false, timeoutMs: 40_000, verifiedBy: [] },
  { tool: 'search_files', label: 'Search project files', location: 'remote', risk: 'read', unattended: false, timeoutMs: 40_000, verifiedBy: [] },
  { tool: 'write_file', label: 'Write a project file', location: 'remote', risk: 'act', unattended: false, timeoutMs: 40_000, verifiedBy: [] },
  { tool: 'edit_project_file', label: 'Change a project file', location: 'remote', risk: 'act', unattended: false, timeoutMs: 40_000, verifiedBy: [] },
  { tool: 'delete_file', label: 'Remove a project file', location: 'remote', risk: 'act', unattended: false, timeoutMs: 40_000, verifiedBy: [] },
  cap('inspect_design', 'Look at a page or picture', 'read', 70_000, ['visual']),
  // Changes files on a person's own computer (always into a new copy), so it needs a person present for now.
  { tool: 'computer_excel', label: 'Work on spreadsheets on your computer', location: 'local', risk: 'act', unattended: false, timeoutMs: 130_000, verifiedBy: ['file'] },
  // Starts programs on a person's own computer after they approve a plan, so it needs a person present.
  { tool: 'run_on_computer', label: 'Run commands on your computer', location: 'local', risk: 'act', unattended: false, timeoutMs: 280_000, verifiedBy: [] },
  // Needs the person's approval of each plan, so it cannot run on its own.
  { tool: 'run_in_cloud', label: 'Run in a cloud box', location: 'remote', risk: 'act', unattended: false, timeoutMs: 300_000, verifiedBy: [] },
  // Adds a server only after the person approves a card, so it needs a person present.
  { tool: 'add_tool_server', label: 'Add a tool server', location: 'remote', risk: 'act', unattended: false, timeoutMs: 30_000, verifiedBy: [] },
  { tool: 'look_in_folder', label: 'Look at files on your computer', location: 'local', risk: 'read', unattended: false, timeoutMs: 50_000, verifiedBy: [] },
  // Safe to run unattended because it never acts alone: it signs in only with the person's hands and sends, buys or deletes only with their OK, and the task pauses ("needs you") until they answer.
  { tool: 'browser', label: 'Use a browser', location: 'remote', risk: 'act', unattended: true, timeoutMs: 80_000, verifiedBy: ['visual'] },
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
