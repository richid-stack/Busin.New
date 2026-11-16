import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { checkRateLimit } from '../../../utils/rateLimit'
import { PushError, saveSubscription } from '../../../services/push/push'

/** Turns alerts on for this device. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  if (!checkRateLimit('push-subscribe', user.id, 20, 3_600_000).ok) throw new HTTPError({ statusCode: 429, statusMessage: 'Too many changes. Try again in a while.' })
  const body = await readValidatedBody(event, z.object({
    endpoint: z.string().max(1000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
    label: z.string().max(60).optional()
  }).strict().parse).catch(() => { throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid device details.' }) })
  try {
    await saveSubscription(getFirebaseDb(), user.id, { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, label: body.label })
  } catch (err) {
    if (err instanceof PushError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
  return { ok: true }
})
