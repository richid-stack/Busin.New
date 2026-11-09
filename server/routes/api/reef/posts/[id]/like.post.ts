import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../utils/reefRoute'

export default reefHandler({ auth: 'required', limit: WRITE('reef-like', 120, 60_000) }, async ({ event, me, reef }) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(64) }).parse)
  return await reef.posts.like(me.id, id)
})
