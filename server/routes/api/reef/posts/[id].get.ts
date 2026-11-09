import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../../utils/reefRoute'

/** One post with its replies. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(64) }).parse)
  const post = await reef.posts.get(id, user?.id)
  const replies = await reef.posts.replies(id, user?.id)
  const [view] = await reef.postViews([post], user?.id)
  return { post: view, replies: await reef.postViews(replies, user?.id, post) }
})
