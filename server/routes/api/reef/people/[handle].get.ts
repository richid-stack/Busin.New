import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { reefHandler } from '../../../../utils/reefRoute'
import { ReefError } from '../../../../services/reef/model'
import { publicProfile } from '../../../../services/reef/profiles'

/** A person's profile, with whether the viewer follows them. Open to everyone. */
export default reefHandler({ auth: 'optional' }, async ({ event, user, reef }) => {
  const { handle } = await getValidatedRouterParams(event, z.object({ handle: z.string().min(1).max(21) }).parse)
  const profile = await reef.profiles.getByHandle(handle)
  if (!profile) throw new ReefError('No one has that handle.', 'not_found')
  const viewerFollows = user && user.id !== profile.userId ? (await reef.profiles.followedAmong(user.id, [profile.userId])).has(profile.userId) : false
  return { ...publicProfile(profile), viewerFollows, isMe: user?.id === profile.userId }
})
