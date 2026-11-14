import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { removeSubscription } from '../../../services/push/push'

/** Turns alerts off for this device. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, z.object({ endpoint: z.string().max(1000) }).strict().parse).catch(() => { throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid device details.' }) })
  await removeSubscription(getFirebaseDb(), user.id, body.endpoint)
  return { ok: true }
})
