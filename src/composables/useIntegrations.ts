import { ref, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { IntegrationItem } from '../types/integrations'
import { useCsrf } from './useCsrf'

export const useIntegrations = createSharedComposable(() => {
  const integrations = ref<IntegrationItem[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  /** The list needs a signed-in user; true when the server answered 401. */
  const unauthorized = ref(false)
  const loadError = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()

  const fetchIntegrations = async () => {
    loading.value = true
    loadError.value = null
    try {
      const headers: Record<string, string> = {}
      const token = csrf()
      if (token) headers[headerName] = token

      const data = await $fetch<IntegrationItem[]>('/api/integrations', { headers })
      integrations.value = Array.isArray(data) ? data : []
      unauthorized.value = false
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status ?? err?.response?.status
      if (status === 401 || status === 403) {
        unauthorized.value = true
        integrations.value = []
      } else {
        loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load integrations.'
      }
    } finally {
      loading.value = false
      loaded.value = true
    }
  }

  const installedIntegrations = computed(() =>
    integrations.value.filter(i => i.status === 'connected')
  )

  /** False when the server has no Composio key; every connect would fail. */
  const canConnect = computed(() =>
    integrations.value.length === 0 || integrations.value.some(i => i.canConnect)
  )

  const getIntegrationByProvider = (provider: string) => {
    return integrations.value.find(i => i.provider === provider)
  }

  return {
    integrations,
    loading,
    loaded,
    unauthorized,
    loadError,
    canConnect,
    fetchIntegrations,
    installedIntegrations,
    getIntegrationByProvider
  }
})
