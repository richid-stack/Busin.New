export interface AgentProfile {
  id: string
  name: string
  description: string
  instructions: string
  /** null: use the model chosen in the chat. */
  model: string | null
  /** Tool group ids the agent may use. */
  tools: string[]
  /** Skill names the agent may use. */
  skills: string[]
  maxSteps: number
  createdAt: string
  updatedAt: string
}

export type AgentInput = Omit<AgentProfile, 'id' | 'createdAt' | 'updatedAt'>

export interface AgentOptions {
  toolGroups: Array<{ id: string, label: string, detail: string, sensitive: boolean }>
  defaultGroups: string[]
  skills: Array<{ name: string, description: string }>
  limits: { maxAgents: number, maxInstructions: number, minSteps: number, maxSteps: number, defaultSteps: number }
}
