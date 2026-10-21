import { DEFAULT_STEPS, TOOL_GROUPS, agentInputSchema } from './profile'
import type { AgentInput } from './profile'

/** Groups an assistant-made proposal may switch on. Ones that act in the person's accounts are left for the person to turn on themselves. */
export const PROPOSABLE_GROUPS = TOOL_GROUPS.filter(g => !g.sensitive).map(g => g.id)

export interface AgentProposal {
  draft: AgentInput
  /** Groups the assistant asked for that were not allowed or do not exist. */
  dropped: string[]
}

/**
 * Turns what the model drafted into something the person can save: validated by the same rules as any
 * agent, with no sensitive tools and no skills or model pinned. Nothing is saved here.
 */
export function makeProposal(raw: { name: string, description?: string, instructions: string, tools?: string[], maxSteps?: number }): { ok: true, proposal: AgentProposal } | { ok: false, error: string } {
  const asked = [...new Set(raw.tools ?? [])]
  const tools = asked.filter(id => PROPOSABLE_GROUPS.includes(id))
  const dropped = asked.filter(id => !PROPOSABLE_GROUPS.includes(id))
  const parsed = agentInputSchema.safeParse({
    name: raw.name,
    description: raw.description ?? '',
    instructions: raw.instructions,
    model: null,
    tools,
    skills: [],
    maxSteps: raw.maxSteps ?? DEFAULT_STEPS
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(i => i.message).join(' ') }
  return { ok: true, proposal: { draft: parsed.data, dropped } }
}
