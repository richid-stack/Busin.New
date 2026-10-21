import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { BillingError, applyPayment, defaultBillingDeps } from '../../../services/billing/billing'

/** Called when the person comes back from Paystack, so Pro starts at once even if the webhook is slow. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'verify-payment', user.id, 30, 10 * 60_000)
  const body = await readValidatedBody(event, z.object({ reference: z.string().max(100) }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Missing payment reference.' })
  })
  try {
    return await applyPayment(defaultBillingDeps(), body.reference, { requireUserId: user.id })
  } catch (err) {
    if (err instanceof BillingError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
