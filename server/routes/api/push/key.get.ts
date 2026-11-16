import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { getVapidKeys } from '../../../services/push/push'

/** The public half of the key alerts are signed with. A browser needs it to turn alerts on. */
export default defineHandler(async (event) => {
  await requireUser(event)
  return { publicKey: (await getVapidKeys(getFirebaseDb())).publicKey }
})
