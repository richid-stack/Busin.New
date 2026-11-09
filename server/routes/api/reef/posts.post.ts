import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../utils/reefRoute'

export default reefHandler({ auth: 'required', limit: WRITE('reef-post', 30) }, async ({ event, me, reef }) => {
  const body = await readValidatedBody(event, z.object({ text: z.string().max(2000), projectId: z.string().max(100).nullish() }).parse)
  const post = await reef.posts.create(me.id, body)
  return (await reef.postViews([post], me.id))[0]
})
