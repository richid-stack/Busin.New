import { defineHandler, HTTPError } from 'nitro'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { checkRateLimit } from '../../../utils/rateLimit'
import { sendPushToUser } from '../../../services/push/push'

/** Sends one alert to the person's own devices so they can see it works. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  if (!checkRateLimit('push-test', user.id, 5, 3_600_000).ok) throw new HTTPError({ statusCode: 429, statusMessage: 'That is enough test alerts for now. Try again in an hour.' })
  const sent = await sendPushToUser({ db: getFirebaseDb() }, user.id, { title: 'OpenLobs', body: 'Alerts work on this device. This is where you will hear when something needs you.', url: '/settings', tag: 'test' })
  return { sent }
})
