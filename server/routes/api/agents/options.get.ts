import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { skills } from '../../../services/skills/registry'
import { DEFAULT_GROUPS, DEFAULT_STEPS, MAX_AGENTS_PER_USER, MAX_INSTRUCTIONS_CHARS, MAX_STEPS, MIN_STEPS, TOOL_GROUPS } from '../../../services/agents/profile'

/** What the agent editor offers: tool groups, skills and limits. */
export default defineHandler(async (event) => {
  await requireUser(event)
  return {
    toolGroups: TOOL_GROUPS.map(({ id, label, detail, sensitive }) => ({ id, label, detail, sensitive: Boolean(sensitive) })),
    defaultGroups: DEFAULT_GROUPS,
    skills: skills.map(s => ({ name: s.name, description: s.description })),
    limits: { maxAgents: MAX_AGENTS_PER_USER, maxInstructions: MAX_INSTRUCTIONS_CHARS, minSteps: MIN_STEPS, maxSteps: MAX_STEPS, defaultSteps: DEFAULT_STEPS }
  }
})
