import { looksReadOnly } from '../../utils/writeGate'
import { composioToolkitSlug } from './slugs'
import { getAgentClient } from './execute'

export interface ToolkitAction { slug: string, name: string, description: string, effect: 'read' | 'change' }
export interface ToolkitActions { total: number, actions: ToolkitAction[] }

const TTL = 6 * 60 * 60_000
const cache = new Map<string, { at: number, value: ToolkitActions }>()

/** Shapes what Composio lists for an app: its real tools, each marked as only looking or able to change things. */
export function describeTools(raw: Array<{ slug?: string, name?: string, description?: string }>): ToolkitActions {
  const actions = raw
    .filter(t => typeof t.slug === 'string' && t.slug)
    .map(t => ({
      slug: t.slug!,
      name: String(t.name || t.slug).slice(0, 80),
      description: String(t.description || '').replace(/\s+/g, ' ').slice(0, 240),
      effect: looksReadOnly(t.slug!) ? 'read' as const : 'change' as const
    }))
    .sort((a, b) => Number(a.effect === 'change') - Number(b.effect === 'change') || a.name.localeCompare(b.name))
  return { total: actions.length, actions }
}

/** Every action an app offers, from Composio itself. Null when Composio is not set up or cannot be reached. */
export async function listToolkitActions(provider: string): Promise<ToolkitActions | null> {
  const toolkit = composioToolkitSlug(provider)
  const hit = cache.get(toolkit)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const client = getAgentClient()
  if (!client) return null
  try {
    // A limit turns off Composio's "important only" filter, so this is the whole list.
    const raw = await client.tools.getRawComposioTools({ toolkits: [toolkit], limit: 300 })
    const value = describeTools(raw as any)
    cache.set(toolkit, { at: Date.now(), value })
    return value
  } catch (err) {
    console.warn('[integrations] Could not list actions for', toolkit, (err as Error)?.message)
    return null
  }
}
