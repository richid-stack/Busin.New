import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { MyModel, ProviderDetail, ProviderRow } from '../types/models'
import { useCsrf } from './useCsrf'

/** The providers a person can connect, the ones they did, and the models they switched on. */
export const useModelProviders = createSharedComposable(() => {
  const providers = ref<ProviderRow[]>([])
  const myModels = ref<MyModel[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const myLoaded = ref(false)
  const unauthorized = ref(false)
  const loadError = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()

  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }
  const idPath = (id: string) => `/api/model-providers/${encodeURIComponent(id)}`

  let generation = 0
  async function fetchProviders() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const res = await $fetch<{ providers: ProviderRow[] }>('/api/model-providers', { headers: headers() })
      if (mine !== generation) return
      providers.value = res.providers
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) {
        unauthorized.value = true
        providers.value = []
      } else {
        loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your model providers.'
      }
    } finally {
      if (mine === generation) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  /** Quiet: the picker calls this and simply shows no extra models if it fails or the person is signed out. */
  async function fetchMyModels() {
    try {
      myModels.value = (await $fetch<{ models: MyModel[] }>('/api/my-models', { headers: headers() })).models
    } catch {
      myModels.value = []
    } finally {
      myLoaded.value = true
    }
  }

  const refreshAll = async () => { await Promise.all([fetchProviders(), fetchMyModels()]) }

  async function connect(id: string, key: string, baseUrl = ''): Promise<ProviderDetail> {
    const detail = await $fetch<ProviderDetail>(`${idPath(id)}/connect`, { method: 'POST', headers: headers(), body: { key, baseUrl } })
    await refreshAll()
    return detail
  }
  async function refresh(id: string): Promise<ProviderDetail> {
    const detail = await $fetch<ProviderDetail>(`${idPath(id)}/refresh`, { method: 'POST', headers: headers() })
    await refreshAll()
    return detail
  }
  const detail = (id: string) => $fetch<ProviderDetail>(idPath(id), { headers: headers() })
  async function saveSelection(id: string, enabled: string[], manual: string[]): Promise<ProviderDetail> {
    const d = await $fetch<ProviderDetail>(`${idPath(id)}/selection`, { method: 'PUT', headers: headers(), body: { enabled, manual } })
    await refreshAll()
    return d
  }
  async function remove(id: string) {
    await $fetch(idPath(id), { method: 'DELETE', headers: headers() })
    await refreshAll()
  }

  return { providers, myModels, loading, loaded, myLoaded, unauthorized, loadError, fetchProviders, fetchMyModels, connect, refresh, detail, saveSelection, remove }
})
