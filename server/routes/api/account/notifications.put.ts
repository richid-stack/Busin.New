import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { setNotificationSettings } from '../../../services/notifications/notify'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const patch = await readValidatedBody(event, z.object({
    emailRenewals: z.boolean().optional(),
    emailWorkflowFailures: z.boolean().optional(),
    emailTaskResults: z.boolean().optional()
  }).strict().parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid settings.' })
  })
  return await setNotificationSettings(getFirebaseDb(), user.id, patch)
})
