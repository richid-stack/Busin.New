/**
 * Powers: what the assistant may use at all. A person switches one off in Settings > Powers and the matching tools are
 * not offered in their chats or tasks (the model is never told they exist). Memory has its own switch on the Memory page.
 * This file is plain functions so the browser and the server agree, and so it can be tested without a database.
 */
export const POWERS = ['web', 'browser', 'computer', 'cloud', 'apps', 'notes'] as const
export type Power = typeof POWERS[number]
export type Powers = Record<Power, boolean>

export const DEFAULT_POWERS: Powers = { web: true, browser: true, computer: true, cloud: true, apps: true, notes: true }

const WEB = new Set(['web_search', 'web_fetch', 'fetch_file', 'view_image', 'look_at_page', 'design_tokens', 'find_icons', 'find_fonts', 'find_photos', 'github_read'])
const COMPUTER = new Set(['computer_excel', 'run_on_computer', 'look_in_folder'])
const APPS = new Set(['integration_status', 'integration_execute', 'add_tool_server'])
const NOTES = new Set(['save_to_notes', 'update_where_we_are'])

/** Which power a tool belongs to, or null when it is always available (charts, files the person asked for, memory, and so on). */
export function powerOf(toolName: string): Power | null {
  if (WEB.has(toolName)) return 'web'
  if (toolName === 'browser') return 'browser'
  if (COMPUTER.has(toolName)) return 'computer'
  if (toolName === 'run_in_cloud') return 'cloud'
  if (NOTES.has(toolName)) return 'notes'
  if (APPS.has(toolName) || toolName.startsWith('mcp_')) return 'apps'
  return null
}

/** Anything stored that is not exactly `false` counts as on, so a missing or damaged value never takes a power away. */
export function readPowers(raw: unknown): Powers {
  const out = { ...DEFAULT_POWERS }
  if (raw && typeof raw === 'object') for (const p of POWERS) if ((raw as Record<string, unknown>)[p] === false) out[p] = false
  return out
}

/**
 * What a chat inside a workspace may use: a power must be on in Settings and in the workspace. A workspace can only
 * switch things off; it can never turn on what Settings turned off.
 */
export function combinePowers(account: Partial<Powers> | undefined, workspace: Partial<Powers> | undefined): Powers {
  const a = readPowers(account)
  const w = readPowers(workspace)
  return Object.fromEntries(POWERS.map(p => [p, a[p] && w[p]])) as Powers
}

/** The tools left once the switched-off powers are taken away. */
export function applyPowers<R extends Record<string, unknown>>(tools: R, powers: Partial<Powers> | undefined): R {
  if (!powers) return tools
  const off = (p: Power | null) => p !== null && powers[p] === false
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !off(powerOf(name)))) as R
}
