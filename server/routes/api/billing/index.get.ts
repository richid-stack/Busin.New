import { defineHandler } from 'nitro'
import { requireUser } from '../../../utils/session'
import { billingCurrency, billingEnabled, billingOptions, defaultBillingDeps, listPayments } from '../../../services/billing/billing'

/** What can be bought and what this person has paid, for the plan card in Settings. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return {
    enabled: billingEnabled(),
    currency: billingCurrency(),
    options: billingEnabled() ? billingOptions() : [],
    payments: await listPayments(defaultBillingDeps(), user.id)
  }
})
