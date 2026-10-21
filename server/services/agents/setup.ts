import { agentPrompt, filterTools } from './profile'
import type { Agent } from './profile'

export interface ChatSetup<T> {
  tools: T
  model: string
  maxSteps: number
  /** Whether the "workflows and connected apps" instructions apply. */
  workflowPrompt: boolean
  /** Extra instructions for the model when an agent is in charge; empty otherwise. */
  rolePrompt: string
}

/**
 * Works out what a chat turn may use. Without an agent that is everything, as before. With one it is
 * the agent's tool groups, its model (when it has one) and its step limit. Skills are narrowed by the
 * caller with `filterSkills`, because the `load_skill` tool is built from them.
 */
export function resolveChatSetup<T extends Record<string, unknown>>(input: {
  agent: Agent | null
  tools: T
  model: string
  defaultSteps: number
}): ChatSetup<Partial<T>> {
  const { agent } = input
  if (!agent) {
    return { tools: input.tools, model: input.model, maxSteps: input.defaultSteps, workflowPrompt: true, rolePrompt: '' }
  }
  const tools = filterTools(input.tools, agent)
  return {
    tools,
    model: agent.model ?? input.model,
    maxSteps: agent.maxSteps,
    workflowPrompt: agent.tools.includes('apps') || agent.tools.includes('workflows'),
    rolePrompt: agentPrompt(agent, Object.keys(tools))
  }
}
