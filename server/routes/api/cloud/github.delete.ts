import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { disconnectGithub } from '../../../services/cloudbox/githubStore'
import { cloudOverview } from '../../../services/cloudbox/overview'

/** Forgets the token. The repo and its files stay in the person's GitHub; they can delete the token or the repo there. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'github-disconnect', user.id, 10, 10 * 60_000)
  const db = getFirebaseDb()
  await disconnectGithub(db, user.id)
  return await cloudOverview(db, user.id)
})
