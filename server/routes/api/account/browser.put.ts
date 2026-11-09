import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { setBrowserWhere } from '../../../services/browser/where'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'browser-where', user.id, 30, 10 * 60_000)
  const body = await readValidatedBody(event, z.object({ where: z.enum(['cloud', 'computer']) }).strict().parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid setting.' })
  })
  return { where: await setBrowserWhere(getFirebaseDb(), user.id, body.where) }
})
