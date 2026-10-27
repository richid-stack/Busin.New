import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../utils/reefRoute'

/** A reply to a post, or an answer to a question. */
export default reefHandler({ auth: 'required', limit: WRITE('reef-post', 60) }, async ({ event, me, reef }) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(64) }).parse)
  const body = await readValidatedBody(event, z.object({ text: z.string().max(4000) }).parse)
  const post = await reef.posts.reply(me.id, id, body)
  return (await reef.postViews([post], me.id))[0]
})
