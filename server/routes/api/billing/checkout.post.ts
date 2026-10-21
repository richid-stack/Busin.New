import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { appUrl } from '../../../utils/appUrl'
import { BillingError, defaultBillingDeps, startCheckout } from '../../../services/billing/billing'

/** Starts a payment and returns the Paystack page to send the person to. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'checkout', user.id, 6, 10 * 60_000)
  const body = await readValidatedBody(event, z.object({ period: z.enum(['month', 'year']) }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Choose a plan period.' })
  })
  try {
    return await startCheckout(defaultBillingDeps(), { userId: user.id, email: user.email, name: user.name, period: body.period, appUrl: appUrl(event) })
  } catch (err) {
    if (err instanceof BillingError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
