import { ref, onScopeDispose } from 'vue'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'
import { useIntegrations } from './useIntegrations'

export const INTEGRATION_AUTH_MESSAGE = 'OPENLOBS_INTEGRATION_AUTH'

function errorMessage(err: any, fallback: string) {
  return err?.data?.statusMessage || err?.statusMessage || err?.message || fallback
}

/**
 * Connect / disconnect an app through the hosted authorization flow. The user authorizes in a
 * popup that lands on /connect-callback, which tells this window it is done.
 */
export function useIntegrationConnect() {
  const toast = useToast()
  const { csrf, headerName } = useCsrf()
  const { fetchIntegrations, getIntegrationByProvider } = useIntegrations()

  /** Provider currently being connected or disconnected. */
  const busyProvider = ref<string | null>(null)

  let cleanup: (() => void) | null = null
  onScopeDispose(() => cleanup?.())

  function waitForAuthorization(popup: Window, attempt: string): Promise<'success' | 'failed' | 'closed'> {
    return new Promise((resolve) => {
      const finish = (result: 'success' | 'failed' | 'closed') => {
        cleanup?.()
        resolve(result)
      }
      const onMessage = (event: MessageEvent) => {
        // Only the popup we opened, for this very attempt, can report the outcome.
        if (event.source !== popup || event.origin !== window.location.origin) return
        if (event.data?.type !== INTEGRATION_AUTH_MESSAGE || event.data?.attempt !== attempt) return
        finish(event.data.status === 'success' ? 'success' : 'failed')
      }
      const timer = window.setInterval(() => {
        if (popup.closed) finish('closed')
      }, 600)

      window.addEventListener('message', onMessage)
      cleanup = () => {
        window.clearInterval(timer)
        window.removeEventListener('message', onMessage)
        cleanup = null
      }
    })
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** The provider can take a moment to turn ACTIVE after authorization, so check a few times. */
  async function waitUntilConnected(provider: string, attempts = 6): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      await fetchIntegrations()
      if (getIntegrationByProvider(provider)?.status === 'connected') return true
      if (i < attempts - 1) await sleep(1200)
    }
    return false
  }

  async function connect(provider: string): Promise<boolean> {
    if (busyProvider.value) return false
    const name = getIntegrationByProvider(provider)?.name || provider
    busyProvider.value = provider
    const attempt = crypto.randomUUID()
    let authorized = false

    try {
      const data = await $fetch<{ redirectUrl?: string }>('/api/integrations/connect', {
        method: 'POST',
        headers: { [headerName]: csrf() },
        body: {
          provider,
          callbackUrl: `${window.location.origin}/connect-callback?attempt=${attempt}`
        }
      })

      if (data?.redirectUrl) {
        const popup = window.open(
          data.redirectUrl,
          `connect_${provider}`,
          'width=560,height=720,scrollbars=yes'
        )
        if (!popup) {
          toast.add({
            title: 'Pop-up blocked',
            description: 'Allow pop-ups for this site, then try again.',
            icon: 'i-lucide-app-window',
            color: 'warning'
          })
          return false
        }

        const outcome = await waitForAuthorization(popup, attempt)
        if (outcome === 'failed') {
          toast.add({
            title: `Could not connect ${name}`,
            description: 'The authorization was not completed.',
            icon: 'i-lucide-circle-alert',
            color: 'error'
          })
          return false
        }
        authorized = outcome === 'success'
      }

      // A closed window may still have finished authorizing, so always confirm with the server.
      const connected = await waitUntilConnected(provider, authorized ? 6 : 2)
      if (connected) {
        toast.add({
          title: `${name} connected`,
          icon: 'i-lucide-circle-check',
          color: 'success'
        })
      } else if (authorized) {
        toast.add({
          title: `${name} is still connecting`,
          description: 'Authorization went through, but it has not shown up yet. Refresh in a moment.',
          icon: 'i-lucide-loader-2',
          color: 'warning'
        })
      }
      return connected
    } catch (err: any) {
      toast.add({
        title: `Could not connect ${name}`,
        description: errorMessage(err, 'Something went wrong. Try again.'),
        icon: 'i-lucide-circle-alert',
        color: 'error'
      })
      return false
    } finally {
      busyProvider.value = null
    }
  }

  async function disconnect(provider: string): Promise<boolean> {
    if (busyProvider.value) return false
    const name = getIntegrationByProvider(provider)?.name || provider
    busyProvider.value = provider

    try {
      await $fetch(`/api/integrations/${provider}`, {
        method: 'DELETE',
        headers: { [headerName]: csrf() }
      })
      await fetchIntegrations()
      toast.add({
        title: `${name} disconnected`,
        icon: 'i-lucide-unplug',
        color: 'neutral'
      })
      return true
    } catch (err: any) {
      toast.add({
        title: `Could not disconnect ${name}`,
        description: errorMessage(err, 'Something went wrong. Try again.'),
        icon: 'i-lucide-circle-alert',
        color: 'error'
      })
      return false
    } finally {
      busyProvider.value = null
    }
  }

  /** Saves a person's own key for a service that connects that way (Paystack, Arkesel). */
  async function saveKey(provider: string, credentials: Record<string, string>): Promise<boolean> {
    if (busyProvider.value) return false
    const name = getIntegrationByProvider(provider)?.name || provider
    busyProvider.value = provider
    try {
      const res = await $fetch<{ verified?: boolean }>(`/api/connectors/${provider}`, {
        method: 'PUT',
        headers: { [headerName]: csrf() },
        body: { credentials }
      })
      await fetchIntegrations()
      toast.add({
        title: `${name} connected`,
        description: res?.verified ? 'The key was checked and saved.' : 'The key was saved. It is checked the first time you use it.',
        icon: 'i-lucide-circle-check',
        color: 'success'
      })
      return true
    } catch (err: any) {
      toast.add({
        title: `Could not connect ${name}`,
        description: errorMessage(err, 'Something went wrong. Try again.'),
        icon: 'i-lucide-circle-alert',
        color: 'error'
      })
      return false
    } finally {
      busyProvider.value = null
    }
  }

  return { busyProvider, connect, disconnect, saveKey }
}
