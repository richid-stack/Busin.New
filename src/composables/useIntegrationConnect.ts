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

  function waitForAuthorization(popup: Window): Promise<'success' | 'failed' | 'closed'> {
    return new Promise((resolve) => {
      const finish = (result: 'success' | 'failed' | 'closed') => {
        cleanup?.()
        resolve(result)
      }
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return
        if (event.data?.type !== INTEGRATION_AUTH_MESSAGE) return
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

  async function connect(provider: string): Promise<boolean> {
    if (busyProvider.value) return false
    const name = getIntegrationByProvider(provider)?.name || provider
    busyProvider.value = provider

    try {
      const data = await $fetch<{ redirectUrl?: string }>('/api/integrations/connect', {
        method: 'POST',
        headers: { [headerName]: csrf() },
        body: {
          provider,
          callbackUrl: `${window.location.origin}/connect-callback`
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

        const outcome = await waitForAuthorization(popup)
        if (outcome === 'failed') {
          toast.add({
            title: `Could not connect ${name}`,
            description: 'The authorization was not completed.',
            icon: 'i-lucide-circle-alert',
            color: 'error'
          })
          return false
        }
      }

      await fetchIntegrations()
      const connected = getIntegrationByProvider(provider)?.status === 'connected'
      if (connected) {
        toast.add({
          title: `${name} connected`,
          icon: 'i-lucide-circle-check',
          color: 'success'
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

  return { busyProvider, connect, disconnect }
}
