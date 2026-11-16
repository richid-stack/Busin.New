import { tool } from 'ai'
import { z } from 'zod'
import { reef as defaultReef } from '../../services/reef/reef'
import type { Reef } from '../../services/reef/reef'
import { withToolLimits } from './limits'

/**
 * Searches what people have shared in the Reef: published agents with their description, what they need, how many
 * people installed them and whether they passed the safety check. Lets the assistant suggest something that already
 * exists before building it again.
 */
export function createCommunitySearchTool(userId: string, getReef: () => Pick<Reef, 'projects'> = defaultReef) {
  return tool({
    description: 'Search the Reef, the OpenLobs community, for agents and projects other people have shared. Use it when the user wants something that may already exist, or to see how others solved a similar job, before building from scratch. Returns name, owner, description, tags, stars, installs and whether it passed the safety check. Tell the user which result you mean by its owner/name.',
    inputSchema: z.object({
      query: z.string().min(2).max(80).describe('Words describing what is wanted, for example "invoice reminders"'),
      sort: z.enum(['new', 'stars']).default('stars')
    }),
    execute: withToolLimits(
      { name: 'community_search', userId, perMinute: 20, timeoutMs: 15_000, maxResultChars: 5_000 },
      async ({ query, sort }) => {
        try {
          const cards = await getReef().projects.list({ q: query, sort, limit: 8 })
          return {
            status: 'ok' as const,
            query,
            count: cards.length,
            projects: cards.map(c => ({ id: `${c.owner}/${c.name}`, description: c.description.slice(0, 240), tags: c.tags.slice(0, 6), stars: c.stars, installs: c.installs, safety: c.safety, licence: c.licence.short, needs: c.works.map(w => w.label).slice(0, 5) })),
            note: cards.length ? 'Projects marked "review" have not passed the safety check yet: say so before suggesting one.' : 'Nothing in the Reef matches yet.'
          }
        } catch {
          return { status: 'failed' as const, query, error: 'The Reef could not be searched right now.' }
        }
      }
    )
  })
}
