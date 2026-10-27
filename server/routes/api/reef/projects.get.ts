import { getValidatedQuery } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../utils/reefRoute'

/** Browse projects: newest, or most starred; `q` and `tag` narrow it. */
export default reefHandler({ auth: 'optional' }, async ({ event, reef }) => {
  const q = await getValidatedQuery(event, z.object({ sort: z.enum(['new', 'stars']).default('new'), q: z.string().max(80).optional(), tag: z.string().max(40).optional(), before: z.string().max(40).optional() }).parse)
  const items = await reef.projects.list(q)
  return { items, next: !q.q && !q.tag && q.sort === 'new' && items.length >= 20 ? items.at(-1)!.updatedAt : null }
})
