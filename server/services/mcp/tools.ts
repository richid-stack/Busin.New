import { createHash } from 'node:crypto'

/** Limits that keep MCP tools affordable (every tool description costs tokens on every turn) and safe. */
export const MCP_LIMITS = {
  maxServersPerUser: 5,
  maxApprovedPerUser: 25,
  maxApprovedPerServer: 15,
  maxDescriptionChars: 500,
  maxSchemaBytes: 8_000,
  maxToolsListed: 200,
  maxNameChars: 40
}

export class McpError extends Error {}

/** A limit or a clash that depends on what else the person has, reported as a conflict (409). */
export class McpConflict extends McpError {}

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** What the server says about the tool. A hint to show the user, never trusted, never part of the fingerprint. */
  annotations?: { readOnlyHint?: boolean, destructiveHint?: boolean }
}

export interface ApprovedTool {
  fingerprint: string
  /** The person chose to let this tool run without being asked each time. Without it, every use waits for their Approve. */
  runWithoutAsking?: boolean
  description: string
  inputSchema: Record<string, unknown>
}

/** JSON with sorted keys, so the same tool always gives the same text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Text the model will read, cleaned: no control characters, bounded length. */
export function cleanDescription(text: unknown): string {
  return String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, MCP_LIMITS.maxDescriptionChars)
}

/**
 * Turns what a server reports into a tool we accept, or null: a sane name, an object-shaped input and
 * a schema of reasonable size. Everything the model will see goes through here before it is fingerprinted.
 */
export function normalizeTool(raw: any): McpToolDef | null {
  const name = typeof raw?.name === 'string' ? raw.name : ''
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) return null
  const schema = raw?.inputSchema && typeof raw.inputSchema === 'object' && !Array.isArray(raw.inputSchema) ? raw.inputSchema : { type: 'object', properties: {} }
  if (schema.type !== 'object') return null
  if (Buffer.byteLength(canonical(schema)) > MCP_LIMITS.maxSchemaBytes) return null
  const annotations = raw?.annotations && typeof raw.annotations === 'object'
    ? { ...(typeof raw.annotations.readOnlyHint === 'boolean' ? { readOnlyHint: raw.annotations.readOnlyHint } : {}), ...(typeof raw.annotations.destructiveHint === 'boolean' ? { destructiveHint: raw.annotations.destructiveHint } : {}) }
    : undefined
  return { name, description: cleanDescription(raw?.description), inputSchema: schema, ...(annotations && Object.keys(annotations).length ? { annotations } : {}) }
}

/** What a user approves is exactly name + description + input schema; a change to any of them is a different tool. */
export function fingerprintTool(def: Pick<McpToolDef, 'name' | 'description' | 'inputSchema'>): string {
  return createHash('sha256').update(canonical({ name: def.name, description: def.description, inputSchema: def.inputSchema })).digest('hex')
}

export type ToolStatus = 'approved' | 'changed' | 'new'

export interface DriftReport {
  unchanged: string[]
  /** Approved before, but name, description or schema is different now. */
  changed: string[]
  /** Approved before, no longer offered. */
  removed: string[]
  /** Offered now, never approved. */
  added: string[]
}

export function detectToolDrift(approved: Record<string, ApprovedTool>, current: McpToolDef[]): DriftReport {
  const now = new Map(current.map(t => [t.name, t]))
  const report: DriftReport = { unchanged: [], changed: [], removed: [], added: [] }
  for (const [name, saved] of Object.entries(approved)) {
    const live = now.get(name)
    if (!live) report.removed.push(name)
    else if (fingerprintTool(live) === saved.fingerprint) report.unchanged.push(name)
    else report.changed.push(name)
  }
  for (const t of current) if (!(t.name in approved)) report.added.push(t.name)
  return report
}

export function toolStatus(approved: Record<string, ApprovedTool>, def: McpToolDef): ToolStatus {
  const saved = approved[def.name]
  if (!saved) return 'new'
  return saved.fingerprint === fingerprintTool(def) ? 'approved' : 'changed'
}

/** A short lowercase label for a server, used inside tool names the model sees. */
export function serverSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'server'
}

/** The name the model uses: mcp_<server>_<tool>, letters, digits, _ and - only, at most 64 characters, unique. */
export function modelToolName(slug: string, tool: string, taken: Set<string>): string {
  const base = `mcp_${slug}_${tool.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64)
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 64 - String(i).length - 1)}_${i}`
  taken.add(name)
  return name
}

/** Checks a request to approve tools against what the server offers right now and the caps. */
export function planApproval(offered: McpToolDef[], wanted: Array<{ name: string, fingerprint: string, runWithoutAsking?: boolean }>, otherServersApproved: number): Record<string, ApprovedTool> {
  const byName = new Map(offered.map(t => [t.name, t]))
  // What is stored is what the person was shown: each tool comes with the fingerprint of the version they reviewed.
  const seen = new Map(wanted.map(w => [w.name, w.fingerprint]))
  const unasked = new Set(wanted.filter(w => w.runWithoutAsking === true).map(w => w.name))
  const names = [...seen.keys()]
  if (names.length > MCP_LIMITS.maxApprovedPerServer) throw new McpError(`Approve at most ${MCP_LIMITS.maxApprovedPerServer} tools per server.`)
  if (names.length + otherServersApproved > MCP_LIMITS.maxApprovedPerUser) throw new McpError(`You can have ${MCP_LIMITS.maxApprovedPerUser} approved MCP tools in total. Remove some from another server first.`)
  const out: Record<string, ApprovedTool> = {}
  for (const name of names) {
    const def = byName.get(name)
    if (!def) throw new McpError(`The server does not offer a tool called "${name}" right now.`)
    if (fingerprintTool(def) !== seen.get(name)) throw new McpError(`"${name}" changed since you opened the review. Open it again and read the new version before approving.`)
    out[name] = { fingerprint: fingerprintTool(def), description: def.description, inputSchema: def.inputSchema, ...(unasked.has(name) ? { runWithoutAsking: true } : {}) }
  }
  return out
}
