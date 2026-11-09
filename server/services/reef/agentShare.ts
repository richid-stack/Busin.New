import { TOOL_GROUPS, agentInputSchema } from '../agents/profile'
import type { Agent, AgentInput } from '../agents/profile'
import { scanText } from './scan'
import type { ScanResult } from './scan'

/**
 * What a shared agent is: a snapshot of its text and settings, never of the person's account (no model, key,
 * chat, memory or connection), what it needs, and how it becomes an agent in someone else's OpenLobs.
 */

/** What is copied out of an agent. The model is left out on purpose: it may be the person's own key. */
export type SharedAgent = Pick<AgentInput, 'name' | 'description' | 'instructions' | 'tools' | 'skills' | 'maxSteps'>

export interface Need { id: string, label: string, detail: string, sensitive: boolean }

export function payloadOf(agent: Pick<Agent, 'name' | 'description' | 'instructions' | 'tools' | 'skills' | 'maxSteps'>): SharedAgent {
  const { name, description, instructions, tools, skills, maxSteps } = agentInputSchema.parse({ ...agent, model: null })
  return { name, description, instructions, tools, skills, maxSteps }
}

/** What the thing can do once installed, in the same words as the agent editor. */
export function needsOf(payload: Pick<SharedAgent, 'tools'>): Need[] {
  return TOOL_GROUPS.filter(g => payload.tools.includes(g.id)).map(g => ({ id: g.id, label: g.label, detail: g.detail, sensitive: Boolean(g.sensitive) }))
}

export function scanPayload(payload: SharedAgent): ScanResult {
  return scanText({ name: payload.name, description: payload.description, instructions: payload.instructions })
}

/**
 * Turns a share into the agent a person gets. Groups that reach into accounts or outside servers
 * come switched off unless the person ticked them, so a stranger's agent cannot use the apps you
 * already connected just because you installed it. Skills this server does not have are left out.
 */
export function agentFromShare(payload: SharedAgent, allow: string[], knownSkills: Set<string>): { input: AgentInput, withheld: Need[], droppedSkills: string[] } {
  const needs = needsOf(payload)
  const kept = needs.filter(n => !n.sensitive || allow.includes(n.id)).map(n => n.id)
  const droppedSkills = payload.skills.filter(s => !knownSkills.has(s))
  const input = agentInputSchema.parse({ ...payload, model: null, tools: kept, skills: payload.skills.filter(s => knownSkills.has(s)) })
  return { input, withheld: needs.filter(n => n.sensitive && !allow.includes(n.id)), droppedSkills }
}
