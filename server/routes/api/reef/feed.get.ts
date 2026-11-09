import { getValidatedQuery } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../utils/reefRoute'

/** The home feed. For you: everyone's newest. Following: people you follow. Questions: questions only. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const q = await getValidatedQuery(event, z.object({ tab: z.enum(['foryou', 'following', 'questions']).default('foryou'), before: z.string().max(40).optional() }).parse)
  const list = await reef.posts.feed({ tab: q.tab, viewerId: user?.id, before: q.before })
  return { items: await reef.postViews(list, user?.id), next: list.length >= 20 ? list.at(-1)!.createdAt : null }
})
