import { getValidatedQuery } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../utils/reefRoute'
import { authorOf } from '../../../services/reef/profiles'

/** Projects (by name, words and tags) and people (by the start of a handle). */
export default reefHandler({ auth: 'optional', limit: ['reef-search', 60, 60_000] }, async ({ event, reef }) => {
  const { q } = await getValidatedQuery(event, z.object({ q: z.string().max(80).default('') }).parse)
  const text = q.trim()
  if (!text) return { projects: [], people: [] }
  const [projects, people] = await Promise.all([reef.projects.list({ q: text, limit: 8 }), reef.profiles.searchHandles(text, 5)])
  return { projects, people: people.map(authorOf) }
})
