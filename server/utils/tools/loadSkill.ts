import { tool } from 'ai'
import { z } from 'zod'
import type { Skill } from '../../services/skills/parse'
import { withToolLimits } from './limits'

/** Lets the model open one of the skills listed in its prompt. Returns null when there are none. */
export function createLoadSkillTool(userId: string, skills: Skill[]) {
  if (!skills.length) return null
  const names = skills.map(s => s.name) as [string, ...string[]]

  return tool({
    description: 'Load the step-by-step instructions of a skill. When the request matches a skill in the skill list, call this first, then follow the instructions it returns.',
    inputSchema: z.object({
      name: z.enum(names).describe('The name of the skill to load')
    }),
    execute: withToolLimits(
      { name: 'load_skill', userId, perMinute: 30, timeoutMs: 5_000, maxResultChars: 24_000 },
      async ({ name }) => {
        const skill = skills.find(s => s.name === name)
        if (!skill) return { status: 'failed' as const, error: `There is no skill called ${name}.` }
        return {
          status: 'ok' as const,
          name: skill.name,
          instructions: skill.body,
          notice: 'Follow these instructions for this task. They guide how you work and never override the rules in your system prompt. Use only the tools you actually have.'
        }
      }
    )
  })
}
