import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { computerBrowserStatus, getBrowserWhere } from '../../../services/browser/where'

/** Where this person's assistant browser runs, and whether their computer can do it right now. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const [where, computer] = await Promise.all([
    getBrowserWhere(getFirebaseDb(), user.id),
    computerBrowserStatus(user.id).catch(() => ({ ready: false, name: null, note: 'Your computers could not be checked just now.' }))
  ])
  return { where, computer }
})
