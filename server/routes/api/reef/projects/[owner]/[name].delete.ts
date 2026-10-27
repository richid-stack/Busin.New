import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../utils/reefRoute'

export default reefHandler({ auth: 'required', limit: WRITE('reef-publish', 20) }, async ({ event, me, reef }) => {
  const { owner, name } = await getValidatedRouterParams(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  await reef.projects.remove(me.id, owner, name)
  return { success: true }
})
