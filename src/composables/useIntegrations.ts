import { ref, computed, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { IntegrationItem } from '../types/integrations'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

export const useIntegrations = createSharedComposable(() => {
  const integrations = ref<IntegrationItem[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  /** The list needs a signed-in user; true when the server answered 401. */
  const unauthorized = ref(false)
  const loadError = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()
  const { firebaseUser } = useFirebaseAuth()

  // Only the newest request may write state, so a slow earlier answer can never overwrite it.
  let generation = 0

  const fetchIntegrations = async () => {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const headers: Record<string, string> = {}
      const token = csrf()
      if (token) headers[headerName] = token

      const data = await $fetch<IntegrationItem[]>('/api/integrations', { headers })
      if (mine !== generation) return
      integrations.value = Array.isArray(data) ? data : []
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status ?? err?.response?.status
      if (status === 401 || status === 403) {
        unauthorized.value = true
        integrations.value = []
      } else {
        loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load integrations.'
      }
    } finally {
      if (mine === generation) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  // A different account must never see the previous account's apps.
  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    integrations.value = []
    loaded.value = false
    loading.value = false
    loadError.value = null
    unauthorized.value = false
  })

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
