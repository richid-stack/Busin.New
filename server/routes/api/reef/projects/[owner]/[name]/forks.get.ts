import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../../../../utils/reefRoute'

export default reefHandler({ auth: 'optional' }, async ({ event, reef }) => {
  const { owner, name } = await getValidatedRouterParams(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  return { items: await reef.projects.listForks(owner, name) }
})
