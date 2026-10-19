import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { MemoryItem, MemoryLimits } from '../types/memory'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

export const useMemory = createSharedComposable(() => {
  const items = ref<MemoryItem[]>([])
  const enabled = ref(true)
  const limits = ref<MemoryLimits>({ maxItems: 30, maxChars: 240 })
  const loading = ref(false)
  const loaded = ref(false)
  const unauthorized = ref(false)
  const loadError = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()
  const { firebaseUser } = useFirebaseAuth()

  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }

  let generation = 0

  async function fetchMemory() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const res = await $fetch<{ enabled: boolean, items: MemoryItem[], limits: MemoryLimits }>('/api/memory', { headers: headers() })
      if (mine !== generation) return
      items.value = res.items ?? []
      enabled.value = res.enabled !== false
      limits.value = res.limits ?? limits.value
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) {
        unauthorized.value = true
        items.value = []
      } else {
        loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your memory.'
      }
    } finally {
      if (mine === generation) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  async function addItem(text: string): Promise<MemoryItem> {
    const item = await $fetch<MemoryItem>('/api/memory', { method: 'POST', headers: headers(), body: { text } })
    if (!items.value.some(i => i.id === item.id)) items.value = [...items.value, item]
    return item
  }

  async function editItem(id: string, text: string): Promise<MemoryItem> {
    const item = await $fetch<MemoryItem>(`/api/memory/${id}`, { method: 'PUT', headers: headers(), body: { text } })
    items.value = items.value.map(i => (i.id === id ? item : i))
    return item
  }

  async function removeItem(id: string) {
    await $fetch(`/api/memory/${id}`, { method: 'DELETE', headers: headers() })
    items.value = items.value.filter(i => i.id !== id)
  }

  async function clearAll() {
    await $fetch('/api/memory', { method: 'DELETE', headers: headers() })
    items.value = []
  }

  async function setEnabled(value: boolean) {
    const before = enabled.value
    enabled.value = value
    try {
      await $fetch('/api/memory/settings', { method: 'PUT', headers: headers(), body: { enabled: value } })
    } catch (err) {
      enabled.value = before
      throw err
    }
  }

  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    items.value = []
    enabled.value = true
    loaded.value = false
    loading.value = false
    loadError.value = null
    unauthorized.value = false
  })

  return { items, enabled, limits, loading, loaded, unauthorized, loadError, fetchMemory, addItem, editItem, removeItem, clearAll, setEnabled }
})
