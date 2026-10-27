import { getValidatedQuery } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../utils/reefRoute'

/** The questions page. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const q = await getValidatedQuery(event, z.object({ filter: z.enum(['new', 'unanswered', 'solved']).default('new'), before: z.string().max(40).optional() }).parse)
  const list = await reef.posts.questions(q)
  return { items: await reef.postViews(list, user?.id), next: list.length >= 20 ? list.at(-1)!.createdAt : null }
})
