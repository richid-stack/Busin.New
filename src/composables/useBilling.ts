import { ref } from 'vue'
import { $fetch } from 'ofetch'
import type { BillingInfo, NotificationSettings, VerifyResult } from '../types/account'
import { useCsrf } from './useCsrf'

/** Plans and payments, and the email notification switches. */
export function useBilling() {
  const billing = ref<BillingInfo | null>(null)
  const notifications = ref<NotificationSettings | null>(null)
  /** True when the plans could not be loaded, so the page can offer a retry instead of pretending nothing is for sale. */
  const billingFailed = ref(false)
  const { csrf, headerName } = useCsrf()

  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }

  async function fetchBilling() {
    try {
      billing.value = await $fetch<BillingInfo>('/api/billing', { headers: headers() })
      billingFailed.value = false
    } catch {
      billingFailed.value = true
    }
  }

  /** Sends the person to Paystack. Resolves only if something went wrong before leaving. */
  async function startCheckout(period: 'month' | 'year') {
    const res = await $fetch<{ url: string }>('/api/billing/checkout', { method: 'POST', headers: headers(), body: { period } })
    window.location.assign(res.url)
  }

  const verifyPayment = (reference: string) =>
    $fetch<VerifyResult>('/api/billing/verify', { method: 'POST', headers: headers(), body: { reference } })

  async function fetchNotifications() {
    try {
      notifications.value = await $fetch<NotificationSettings>('/api/account/notifications', { headers: headers() })
    } catch {
      notifications.value = null
    }
  }

  async function saveNotifications(patch: Partial<Pick<NotificationSettings, 'emailRenewals' | 'emailWorkflowFailures'>>) {
    const next = await $fetch<NotificationSettings>('/api/account/notifications', { method: 'PUT', headers: headers(), body: patch })
    notifications.value = { ...notifications.value, ...next }
  }

  return { billing, billingFailed, notifications, fetchBilling, startCheckout, verifyPayment, fetchNotifications, saveNotifications }
}
