import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../utils/reefRoute'
import { publicProfile } from '../../../services/reef/profiles'

/** Makes the signed-in person's Reef profile and claims their handle. */
export default reefHandler({ auth: 'required', limit: WRITE('reef-profile', 10) }, async ({ event, me, reef }) => {
  const body = await readValidatedBody(event, z.object({ handle: z.string().max(30), name: z.string().max(80).optional(), bio: z.string().max(400).optional(), place: z.string().max(100).optional() }).parse)
  return publicProfile(await reef.profiles.create(me.id, { handle: body.handle, name: body.name ?? me.name, bio: body.bio, place: body.place }, me.name))
})
