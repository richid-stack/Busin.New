import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../../utils/reefRoute'

export default reefHandler({ auth: 'required', limit: WRITE('reef-like', 120, 60_000) }, async ({ event, me, reef }) => {
  const { owner, name } = await getValidatedRouterParams(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  return await reef.projects.star(me.id, owner, name)
})
