import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { BridgeJobItem, ComputerItem, PairingCode } from '../types/bridge'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

export const useBridge = createSharedComposable(() => {
  const computers = ref<ComputerItem[]>([])
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

  async function fetchComputers() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const list = await $fetch<ComputerItem[]>('/api/bridge/devices', { headers: headers() })
      if (mine !== generation) return
      computers.value = Array.isArray(list) ? list.filter(c => !c.revokedAt) : []
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) { unauthorized.value = true; computers.value = [] }
      else loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your computers.'
    } finally {
      if (mine === generation) { loading.value = false; loaded.value = true }
    }
  }

  const newCode = () => $fetch<PairingCode>('/api/bridge/pairings', { method: 'POST', headers: headers() })

  const startTest = (id: string) => $fetch<BridgeJobItem>(`/api/bridge/devices/${encodeURIComponent(id)}/test`, { method: 'POST', headers: headers() })
  const startLook = (id: string, body: { url: string, width?: number, height?: number }) => $fetch<BridgeJobItem>(`/api/bridge/devices/${encodeURIComponent(id)}/look`, { method: 'POST', headers: headers(), body })
  const getJob = (id: string) => $fetch<BridgeJobItem>(`/api/bridge/jobs/${encodeURIComponent(id)}`, { headers: headers() })
  const cancelJob = (id: string) => $fetch<BridgeJobItem>(`/api/bridge/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: headers() })

  async function disconnect(id: string) {
    await $fetch(`/api/bridge/devices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() })
    computers.value = computers.value.filter(c => c.id !== id)
  }

  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    computers.value = []
    loaded.value = false
    loading.value = false
    loadError.value = null
    unauthorized.value = false
  })

  return { computers, loading, loaded, unauthorized, loadError, fetchComputers, newCode, startTest, startLook, getJob, cancelJob, disconnect }
})
