import { getValidatedQuery, getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../../../utils/reefRoute'
import { ReefError } from '../../../../../services/reef/model'

/** What a person posted. `kind=questions` shows only their questions. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const { handle } = await getValidatedRouterParams(event, z.object({ handle: z.string().min(1).max(21) }).parse)
  const q = await getValidatedQuery(event, z.object({ kind: z.enum(['posts', 'questions']).default('posts'), before: z.string().max(40).optional() }).parse)
  const person = await reef.profiles.getByHandle(handle)
  if (!person) throw new ReefError('No one has that handle.', 'not_found')
  const list = await reef.posts.byUser(person.userId, q)
  return { items: await reef.postViews(list, user?.id), next: list.length >= 20 ? list.at(-1)!.createdAt : null }
})
