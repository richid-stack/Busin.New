import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { getPowers } from '../../../services/account/powers'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return { powers: await getPowers(getFirebaseDb(), user.id) }
})
