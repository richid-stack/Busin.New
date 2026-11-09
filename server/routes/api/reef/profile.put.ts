import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../utils/reefRoute'
import { publicProfile } from '../../../services/reef/profiles'

/** Changes what the signed-in person shows: name, bio, place. The handle stays. */
export default reefHandler({ auth: 'required', limit: WRITE('reef-profile', 20) }, async ({ event, me, reef }) => {
  const body = await readValidatedBody(event, z.object({ name: z.string().max(80).optional(), bio: z.string().max(400).optional(), place: z.string().max(100).optional() }).parse)
  return publicProfile(await reef.profiles.update(me.id, body))
})
