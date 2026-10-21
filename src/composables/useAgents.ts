import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { AgentInput, AgentOptions, AgentProfile } from '../types/agents'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

export const useAgents = createSharedComposable(() => {
  const agents = ref<AgentProfile[]>([])
  const options = ref<AgentOptions | null>(null)
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

  // Only the newest request may write state.
  let generation = 0

  async function fetchAgents() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const list = await $fetch<AgentProfile[]>('/api/agents', { headers: headers() })
      if (mine !== generation) return
      agents.value = Array.isArray(list) ? list : []
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) {
        unauthorized.value = true
        agents.value = []
      } else {
        loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your agents.'
      }
    } finally {
      if (mine === generation) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  async function fetchOptions() {
    if (options.value) return
    try {
      options.value = await $fetch<AgentOptions>('/api/agents/options', { headers: headers() })
    } catch {
      // The editor shows its own message when it has no options.
    }
  }

  async function createAgent(input: AgentInput): Promise<AgentProfile> {
    const agent = await $fetch<AgentProfile>('/api/agents', { method: 'POST', headers: headers(), body: input })
    agents.value = [...agents.value, agent]
    return agent
  }

  async function updateAgent(id: string, input: AgentInput): Promise<AgentProfile> {
    const agent = await $fetch<AgentProfile>(`/api/agents/${id}`, { method: 'PUT', headers: headers(), body: input })
    agents.value = agents.value.map(a => (a.id === id ? agent : a))
    return agent
  }

  async function removeAgent(id: string) {
    await $fetch(`/api/agents/${id}`, { method: 'DELETE', headers: headers() })
    agents.value = agents.value.filter(a => a.id !== id)
  }

  // A different account must never see the previous account's agents.
  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    agents.value = []
    loaded.value = false
    loading.value = false
    loadError.value = null
    unauthorized.value = false
  })

  const getAgent = (id: string | null | undefined) => (id ? agents.value.find(a => a.id === id) : undefined)

  return { agents, options, loading, loaded, unauthorized, loadError, fetchAgents, fetchOptions, createAgent, updateAgent, removeAgent, getAgent }
})
