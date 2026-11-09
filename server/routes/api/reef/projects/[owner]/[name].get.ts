import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../../../utils/reefRoute'
import { authorOf } from '../../../../../services/reef/profiles'

/** A project page: README, files, versions, what it needs, and its maker. Open to everyone. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const { owner, name } = await getValidatedRouterParams(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  const detail = await reef.projects.detail(owner, name, user?.id)
  const maker = await reef.profiles.getByHandle(owner)
  return { ...detail, author: maker ? authorOf(maker) : { handle: owner, name: owner, verified: false, official: false } }
})
