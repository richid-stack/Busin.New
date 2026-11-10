import type { McpPreset } from '../../../shared/mcpCatalog'

/**
 * One plain description for everything the assistant can lean on to do a job: an app the person connected, a tool
 * server, a skill, or their own computer. For each thing a job needs it says what it does, whether it can change
 * anything, whether it is ready, and the one step the person has to take if it is not. It only reads: it connects
 * and installs nothing.
 */
export type CapabilityKind = 'app' | 'tool_server' | 'skill' | 'computer'
export type SetupState = 'ready' | 'not_connected' | 'needs_key' | 'offline' | 'unavailable' | 'unknown'
export type Risk = 'reads' | 'changes' | 'guidance'

export interface CapabilityCard {
  kind: CapabilityKind
  id: string
  name: string
  /** What was asked for, in the words the assistant used. */
  asked: string
  does: string
  state: SetupState
  /** reads: only looks. changes: can also send, create or change things. guidance: instructions only. */
  risk: Risk
  /** What the person must provide, in plain words. Empty when ready. */
  needs: string[]
  /** The one next step, or a note when nothing is needed. */
  next: string
  /** Where in OpenLobs the step happens. */
  where?: string
}

export interface AppInfo { provider: string, name: string, type: 'native' | 'composio' | 'custom', status: 'connected' | 'disconnected', description: string, canConnect: boolean, hasActions: boolean, getKeyUrl?: string }
export interface ServerInfo { name: string, enabled: boolean, lastError: string }
export interface ComputerInfo { name: string, online: boolean }

export interface SetupSources {
  apps: () => Promise<AppInfo[]>
  servers: () => Promise<ServerInfo[]>
  presets: McpPreset[]
  skills: { name: string, description: string }[]
  computers: () => Promise<ComputerInfo[]>
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const squash = (s: string) => norm(s).replace(/ /g, '')

/** True when the request names the thing: the same name, or one contains the other (at least 3 letters). */
function names(request: string, candidate: string): boolean {
  const a = squash(request); const b = squash(candidate)
  if (!a || !b) return false
  if (a === b) return true
  return (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b))
}

const COMPUTER_WORDS = ['computer', 'laptop', 'pc', 'desktop', 'bridge']
/** Whole words only, so a name like "topcoder" is not mistaken for a computer. */
const asksForComputer = (request: string) => norm(request).split(' ').some(w => COMPUTER_WORDS.includes(w)) || norm(request).includes('my machine')

function wordOverlap(request: string, text: string): number {
  const words = norm(request).split(' ').filter(w => w.length > 3)
  const hay = norm(text)
  return words.filter(w => hay.includes(w)).length
}

const unknownCard = (asked: string, note: string, suggestions: string[]): CapabilityCard => ({
  kind: 'app', id: '', name: asked, asked, does: '', state: 'unknown', risk: 'reads', needs: [],
  next: suggestions.length ? `${note} Close matches: ${suggestions.join(', ')}.` : note
})

/** Looks up each thing a job needs and reports where it stands. A source that cannot be checked is reported as unknown, never as missing. */
export async function resolveSetup(requests: string[], sources: SetupSources): Promise<CapabilityCard[]> {
  const settle = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f() } catch { return null } }
  const [apps, servers, computers] = await Promise.all([settle(sources.apps), settle(sources.servers), settle(sources.computers)])

  return requests.map((asked): CapabilityCard => {
    // 1. Skills: instructions that are already built in.
    const skill = sources.skills.find(s => squash(asked) === squash(s.name))
    if (skill) return { kind: 'skill', id: skill.name, name: skill.name, asked, does: skill.description, state: 'ready', risk: 'guidance', needs: [], next: 'Built in. It opens when the job needs it.' }

    // 2. The person's own computer.
    if (asksForComputer(asked)) {
      if (computers === null) return { kind: 'computer', id: 'computer', name: 'Your computer', asked, does: 'Works on files and apps on your own computer through the OpenLobs Bridge.', state: 'unknown', risk: 'changes', needs: [], next: 'Could not check your computers just now.', where: '/computers' }
      const online = computers.find(c => c.online)
      if (online) return { kind: 'computer', id: 'computer', name: online.name, asked, does: 'Works on files and apps on your own computer through the OpenLobs Bridge.', state: 'ready', risk: 'changes', needs: [], next: 'Connected and online.', where: '/computers' }
      if (computers.length) return { kind: 'computer', id: 'computer', name: computers[0]!.name, asked, does: 'Works on files and apps on your own computer through the OpenLobs Bridge.', state: 'offline', risk: 'changes', needs: ['Your computer turned on, with the OpenLobs Bridge running'], next: 'Turn the computer on and open the OpenLobs Bridge.', where: '/computers' }
      return { kind: 'computer', id: 'computer', name: 'Your computer', asked, does: 'Works on files and apps on your own computer through the OpenLobs Bridge.', state: 'not_connected', risk: 'changes', needs: ['The OpenLobs Bridge installed on your computer'], next: 'Install the Bridge and pair your computer.', where: '/computers' }
    }

    // 3. Apps the person connects (Gmail, Slack, Notion, ...).
    const app = apps?.find(a => names(asked, a.name) || names(asked, a.provider))
    if (app) {
      const risk: Risk = app.hasActions ? 'changes' : 'reads'
      const base = { kind: 'app' as const, id: app.provider, name: app.name, asked, does: app.description, risk, where: `/integrations/${app.provider}` }
      if (app.status === 'connected') return { ...base, state: 'ready', needs: [], next: 'Connected.' }
      if (!app.canConnect) return { ...base, state: 'unavailable', needs: [], next: 'Connecting apps is not switched on for this OpenLobs yet.' }
      return app.type === 'custom'
        ? { ...base, state: 'needs_key', needs: [`A key from ${app.name}`], next: `Open ${app.name} in Integrations and paste your key${app.getKeyUrl ? ` (you make it at ${app.getKeyUrl})` : ''}.` }
        : { ...base, state: 'not_connected', needs: [`Your ${app.name} sign-in`], next: `Connect ${app.name} in Integrations. It opens the ${app.name} sign-in.` }
    }

    // 4. Tool servers: the person's own first, then the ones OpenLobs has checked.
    const own = servers?.find(s => names(asked, s.name))
    if (own) {
      const ok = own.enabled && !own.lastError
      return { kind: 'tool_server', id: own.name, name: own.name, asked, does: 'A tool server you added.', state: ok ? 'ready' : 'unavailable', risk: 'changes', needs: [], next: ok ? 'Added and on.' : own.enabled ? `It is added but is failing: ${own.lastError}` : 'It is added but switched off.', where: '/integrations/mcp' }
    }
    const preset = sources.presets.find(p => names(asked, p.name) || names(asked, p.id))
    if (preset) {
      return {
        kind: 'tool_server', id: preset.id, name: preset.name, asked, does: preset.summary,
        state: preset.auth === 'key' ? 'needs_key' : 'not_connected', risk: preset.access === 'changes' ? 'changes' : 'reads',
        needs: preset.auth === 'key' ? [preset.keyHelp ? `A key. ${preset.keyHelp}` : `A key from ${preset.name}`] : [],
        next: preset.auth === 'key' ? `Add ${preset.name} in Integrations, under tool servers. You paste the key there; it is never shown in chat.` : `No sign-in needed. It can be added for you (the user approves first), or in Integrations under tool servers. Its tools are then read and allowed one by one on that page.`,
        where: '/integrations/mcp'
      }
    }

    // 5. Nothing matches.
    if (apps === null && servers === null) return unknownCard(asked, 'Could not check what is connected just now.', [])
    const hay: Array<{ name: string, text: string }> = [
      ...(apps ?? []).map(a => ({ name: a.name, text: `${a.name} ${a.description}` })),
      ...sources.presets.map(p => ({ name: p.name, text: `${p.name} ${p.summary}` })),
      ...sources.skills.map(s => ({ name: s.name, text: `${s.name} ${s.description}` }))
    ]
    const close = hay.map(h => ({ n: h.name, score: wordOverlap(asked, h.text) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.n)
    return unknownCard(asked, 'OpenLobs has nothing by that name.', close)
  })
}

export const STATE_LABEL: Record<SetupState, string> = {
  ready: 'ready',
  not_connected: 'needs connecting',
  needs_key: 'needs a key',
  offline: 'computer offline',
  unavailable: 'not available',
  unknown: 'not found'
}
