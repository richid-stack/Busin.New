import { reefHandler } from '../../../utils/reefRoute'
import { publicProfile } from '../../../services/reef/profiles'
import { isReefAdmin } from '../../../services/reef/moderation'

/** Who the signed-in person is in The Reef: their profile (or none yet), unread alerts, and whether they run the place. */
export default reefHandler({ auth: 'optional' }, async ({ user, reef }) => {
  if (!user) return { signedIn: false, name: '', profile: null, unread: 0, admin: false }
  const profile = await reef.profiles.get(user.id)
  return { signedIn: true, name: user.name, profile: profile ? publicProfile(profile) : null, unread: profile ? await reef.alerts.unreadCount(user.id) : 0, admin: isReefAdmin(user) }
})
