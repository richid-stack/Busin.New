import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../utils/reefRoute'

export default reefHandler({ auth: 'required', limit: WRITE('reef-post', 60) }, async ({ event, me, reef }) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(64) }).parse)
  await reef.posts.remove(me.id, id)
  return { success: true }
})
