import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler, WRITE } from '../../../../utils/reefRoute'
import { publicProfile } from '../../../../services/reef/profiles'

/** Hands out or takes back the verified and official badges. */
export default reefHandler({ auth: 'admin', limit: WRITE('reef-admin', 120, 60_000) }, async ({ event, reef }) => {
  const body = await readValidatedBody(event, z.object({ handle: z.string().max(30), verified: z.boolean().optional(), official: z.boolean().optional() }).parse)
  return publicProfile(await reef.profiles.setBadges(body.handle, body))
})
