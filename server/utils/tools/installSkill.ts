import { tool } from 'ai'
import { z } from 'zod'
import { SkillConflict, installSkill } from '../../services/skills/userSkills'
import { safeFetch } from '../netSafety'
import { readExternalSkill } from './externalSkill'
import { githubGetter } from './githubRead'
import type { GithubFetcher } from './githubRead'
import { withToolLimits } from './limits'

export interface InstallSkillDeps {
  read?: typeof readExternalSkill
  save?: typeof installSkill
}

/**
 * Keeps a skill from a public GitHub project in the person's own list, so it is there in every chat, not only this one.
 * The person approves first, because a kept skill steers the assistant from then on. It is read and checked the same way
 * as one opened for a single chat (the safety scan can refuse it), saved only if it passes, and always shown with where
 * it came from. The person sees and removes what is kept on the Skills page.
 */
export function createInstallSkillTool(userId: string, builtIn: string[], fetcher: GithubFetcher = safeFetch as GithubFetcher, env: NodeJS.ProcessEnv = process.env, deps: InstallSkillDeps = {}) {
  const read = deps.read ?? readExternalSkill
  const save = deps.save ?? installSkill
  return tool({
    description: 'Keep a skill from a public GitHub project in the user\'s own list so it is available in every chat. Only when the user asks to keep, add or install a skill (to use it once, use load_external_skill instead). Give the repository as owner/name and the folder that holds SKILL.md. The user approves first.',
    inputSchema: z.object({
      repo: z.string().min(3).max(210).describe('The repository as owner/name'),
      folder: z.string().max(200).default('').describe('The folder that holds SKILL.md, for example skills/pdf. Empty when SKILL.md is at the top.'),
      why: z.string().min(3).max(200).describe('One short sentence: what the user wants it for.')
    }),
    // A kept skill steers the assistant from now on, so the person decides each time.
    needsApproval: true,
    execute: withToolLimits(
      { name: 'install_skill', userId, perMinute: 5, timeoutMs: 30_000, maxResultChars: 4_000 },
      async ({ repo, folder }, signal) => {
        let found
        try { found = await read(githubGetter(fetcher, env, signal), repo, folder) } catch (err: any) {
          return { status: 'failed' as const, repo, error: `${String(err?.message || 'The skill could not be reached.')} Nothing was kept.` }
        }
        if (!found.ok) return { status: 'failed' as const, repo, error: `${found.error} Nothing was kept.` }
        try {
          await save(userId, { skill: found.skill, source: found.source, warnings: found.warnings }, builtIn)
        } catch (err) {
          if (err instanceof SkillConflict) return { status: 'failed' as const, repo, name: found.skill.name, source: found.source, error: err.message }
          return { status: 'failed' as const, repo, name: found.skill.name, source: found.source, error: 'Could not save it. Nothing was kept.' }
        }
        return {
          status: 'installed' as const,
          name: found.skill.name,
          description: found.skill.description,
          source: found.source,
          warnings: found.warnings,
          where: '/skills',
          next: `Kept ${found.skill.name}. It is in the user's list from their next message on, in every chat, and they can see where it came from and remove it on the Skills page. It is not open in this message, so if the user wants it applied right now, open it with load_external_skill. Tell them in plain words. If there are warnings, say what they are.`
        }
      }
    )
  })
}
