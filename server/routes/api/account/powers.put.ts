import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { setPowers } from '../../../services/account/powers'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'powers', user.id, 60, 10 * 60_000)
  const patch = await readValidatedBody(event, z.object({
    web: z.boolean().optional(),
    browser: z.boolean().optional(),
    computer: z.boolean().optional(),
    cloud: z.boolean().optional(),
    apps: z.boolean().optional()
  }).strict().parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid setting.' })
  })
  return { powers: await setPowers(getFirebaseDb(), user.id, patch) }
})
