import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { enforceRateLimit } from '../../utils/rateLimit'
import { getFirebaseDb } from '../../utils/firebaseAdmin'
import { deleteAllChatsFor } from '../../utils/firebase'

/** Settings > Data controls > Delete all chats. Signed-in people only; the page asks them to confirm first. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'delete-all-chats', user.id, 5, 60 * 60_000)
  return { deleted: await deleteAllChatsFor(getFirebaseDb(), user.id) }
})
