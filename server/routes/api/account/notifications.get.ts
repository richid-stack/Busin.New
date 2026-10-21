import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { getNotificationSettings } from '../../../services/notifications/notify'
import { emailConfig } from '../../../services/email/email'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return { ...(await getNotificationSettings(getFirebaseDb(), user.id)), emailAvailable: Boolean(emailConfig()), email: user.email ?? null }
})
