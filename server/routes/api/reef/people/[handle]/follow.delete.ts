import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../utils/reefRoute'

export default reefHandler({ auth: 'required', limit: WRITE('reef-follow', 60) }, async ({ event, me, reef }) => {
  const { handle } = await getValidatedRouterParams(event, z.object({ handle: z.string().min(1).max(21) }).parse)
  return await reef.profiles.unfollow(me.id, handle)
})
