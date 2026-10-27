import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../../../../utils/reefRoute'
import { projectIdOf } from '../../../../../../services/reef/model'

/** Questions people asked about this project. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const { owner, name } = await getValidatedRouterParams(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  const list = await reef.posts.questionsAbout(projectIdOf(owner, name))
  return { items: await reef.postViews(list, user?.id) }
})
