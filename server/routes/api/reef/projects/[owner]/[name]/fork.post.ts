import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../../../utils/reefRoute'
import { projectCard } from '../../../../../../services/reef/projects'

/** A copy under the person's own handle that remembers where it came from. */
export default reefHandler({ auth: 'required', limit: WRITE('reef-publish', 20) }, async ({ event, me, reef }) => {
  const { owner, name } = await getValidatedRouterParams(event, z.object({ owner: z.string().min(1).max(21), name: z.string().min(1).max(41) }).parse)
  const body = await readValidatedBody(event, z.object({ name: z.string().max(60).optional() }).parse)
  return projectCard(await reef.projects.fork(me.id, owner, name, body.name))
})
