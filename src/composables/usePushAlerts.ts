import { onMounted, ref } from 'vue'
import { $fetch } from 'ofetch'
import { deviceLabel, pushAvailability, urlBase64ToBytes } from '../utils/pushSupport'
import type { PushAvailability } from '../utils/pushSupport'
import { useCsrf } from './useCsrf'

/**
 * Alerts on this device: a pop-up for a finished task, a wait, or a workflow that needs an OK, even when OpenLobs is closed.
 * Nothing is registered until the person turns it on.
 */
export function usePushAlerts() {
  const availability = ref<PushAvailability>('unsupported')
  const on = ref(false)
  const busy = ref(false)
  const error = ref('')
  const testSent = ref<'' | 'sent' | 'none'>('')
  const { csrf, headerName } = useCsrf()
  const headers = () => {
    const token = csrf()
    return token ? { [headerName]: token } : {}
  }

  const env = () => ({
    userAgent: navigator.userAgent,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    permission: ('Notification' in window ? Notification.permission : 'unsupported') as 'default' | 'granted' | 'denied' | 'unsupported'
  })

  async function refresh() {
    availability.value = pushAvailability(env())
    on.value = false
    if (availability.value !== 'ready' && availability.value !== 'blocked') return
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      on.value = !!(reg && await reg.pushManager.getSubscription()) && Notification.permission === 'granted'
    } catch { on.value = false }
  }

  async function enable() {
    error.value = ''
    busy.value = true
    try {
      if (pushAvailability(env()) !== 'ready') throw new Error('This browser cannot show alerts.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        availability.value = permission === 'denied' ? 'blocked' : availability.value
        throw new Error(permission === 'denied' ? 'Alerts are blocked in this browser. Allow them in the site settings, then try again.' : 'Alerts were not allowed.')
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const { publicKey } = await $fetch<{ publicKey: string }>('/api/push/key', { headers: headers() })
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) as BufferSource })
      const json = sub.toJSON()
      await $fetch('/api/push/subscribe', { method: 'POST', headers: headers(), body: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth }, label: deviceLabel(navigator.userAgent) } })
      on.value = true
    } catch (err: any) {
      error.value = err?.data?.statusMessage || err?.message || 'Could not turn alerts on. Try again.'
      on.value = false
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    error.value = ''
    busy.value = true
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await $fetch('/api/push/unsubscribe', { method: 'POST', headers: headers(), body: { endpoint: sub.endpoint } }).catch(() => {})
        await sub.unsubscribe()
      }
      on.value = false
    } catch (err: any) {
      error.value = err?.message || 'Could not turn alerts off. Try again.'
    } finally {
      busy.value = false
    }
  }

  async function sendTest() {
    testSent.value = ''
    try {
      const { sent } = await $fetch<{ sent: number }>('/api/push/test', { method: 'POST', headers: headers() })
      testSent.value = sent > 0 ? 'sent' : 'none'
    } catch (err: any) {
      error.value = err?.data?.statusMessage || 'Could not send a test alert.'
    }
  }

  onMounted(refresh)
  return { availability, on, busy, error, testSent, enable, disable, sendTest, refresh }
}
