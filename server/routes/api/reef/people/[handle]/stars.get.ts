import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../../../utils/reefRoute'
import { ReefError } from '../../../../../services/reef/model'

/** Projects a person starred. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const { handle } = await getValidatedRouterParams(event, z.object({ handle: z.string().min(1).max(21) }).parse)
  const person = await reef.profiles.getByHandle(handle)
  if (!person) throw new ReefError('No one has that handle.', 'not_found')
  return { items: await reef.projects.listStarred(person.userId, user?.id) }
})
