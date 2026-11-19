import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { cloudOverview } from '../../../services/cloudbox/overview'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return await cloudOverview(getFirebaseDb(), user.id)
})
