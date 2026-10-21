import { defineHandler, HTTPError } from 'nitro'
import { getHeader } from 'nitro/h3'
import { enforceRateLimit, rateLimitSubject } from '../../../utils/rateLimit'
import { paystackSecret, verifyPaystackSignature } from '../../../services/billing/paystack'
import { BillingError, applyPayment, defaultBillingDeps } from '../../../services/billing/billing'

/**
 * Paystack tells us a payment succeeded. The call is trusted only if it carries a valid signature, and
 * even then the payment is checked again with Paystack before anything is granted.
 */
export default defineHandler(async (event) => {
  const secret = paystackSecret()
  if (!secret) throw new HTTPError({ statusCode: 404, statusMessage: 'Not found' })
  enforceRateLimit(event, 'paystack-webhook', rateLimitSubject(event), 120, 60_000)

  const raw = await event.req.text()
  if (!verifyPaystackSignature(raw, getHeader(event, 'x-paystack-signature'), secret)) {
    throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid body' })
  }

  if (payload?.event === 'charge.success' && typeof payload?.data?.reference === 'string') {
    try {
      await applyPayment(defaultBillingDeps(), payload.data.reference)
    } catch (err) {
      // A payment that is not ours (another product on the same Paystack account) is acknowledged and ignored.
      if (err instanceof BillingError && err.status === 404) return { ok: true, ignored: true }
      // Retrying cannot fix a payment that does not match what was asked for: it is recorded, and Paystack is told it was received.
      if (err instanceof BillingError && err.status === 409) return { ok: true, mismatch: true }
      throw err
    }
  }
  // Anything else is acknowledged so Paystack does not keep retrying events we do not use.
  return { ok: true }
})
