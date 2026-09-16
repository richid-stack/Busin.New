import { ref, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { IntegrationItem } from '../types/integrations'
import { useCsrf } from './useCsrf'

export const useIntegrations = createSharedComposable(() => {
  const integrations = ref<IntegrationItem[]>([])
  const loading = ref(false)
  const { csrf, headerName } = useCsrf()

  const fetchIntegrations = async () => {
    loading.value = true
    try {
      const headers: Record<string, string> = {}
      const token = csrf()
      if (token) headers[headerName] = token

      const data = await $fetch<IntegrationItem[]>('/api/integrations', { headers }).catch(() => null)
      if (data && Array.isArray(data)) {
        integrations.value = data
      }
    } catch (err) {
      console.warn('Could not load integrations list:', err)
    } finally {
      loading.value = false
    }
  }

  const installedIntegrations = computed(() => 
    integrations.value.filter(i => i.status === 'connected')
  )

  const getIntegrationByProvider = (provider: string) => {
    return integrations.value.find(i => i.provider === provider)
  }

  return {
    integrations,
    loading,
    fetchIntegrations,
    installedIntegrations,
    getIntegrationByProvider
  }
})
