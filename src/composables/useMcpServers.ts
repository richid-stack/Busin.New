import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { McpLimits, McpNewServer, McpServerView, McpToolListing } from '../types/mcp'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

export const useMcpServers = createSharedComposable(() => {
  const servers = ref<McpServerView[]>([])
  const limits = ref<McpLimits>({ servers: 5, approvedTotal: 25, approvedPerServer: 15 })
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

  async function fetchServers() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const res = await $fetch<{ servers: McpServerView[], limits: McpLimits }>('/api/mcp/servers', { headers: headers() })
      if (mine !== generation) return
      servers.value = res.servers ?? []
      limits.value = res.limits ?? limits.value
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) {
        unauthorized.value = true
        servers.value = []
      } else {
        loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your MCP servers.'
      }
    } finally {
      if (mine === generation) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  const replace = (server: McpServerView) => { servers.value = servers.value.map(s => (s.id === server.id ? server : s)) }

  async function addServer(input: McpNewServer): Promise<McpServerView> {
    const server = await $fetch<McpServerView>('/api/mcp/servers', { method: 'POST', headers: headers(), body: input })
    servers.value = [...servers.value, server]
    return server
  }

  async function updateServer(id: string, body: Record<string, unknown>): Promise<McpServerView> {
    const server = await $fetch<McpServerView>(`/api/mcp/servers/${id}`, { method: 'PUT', headers: headers(), body })
    replace(server)
    return server
  }

  async function removeServer(id: string) {
    await $fetch(`/api/mcp/servers/${id}`, { method: 'DELETE', headers: headers() })
    servers.value = servers.value.filter(s => s.id !== id)
  }

  /** Connects to the server and returns what it offers right now. */
  async function listTools(id: string): Promise<McpToolListing[]> {
    try {
      const res = await $fetch<{ server: McpServerView, tools: McpToolListing[] }>(`/api/mcp/servers/${id}/tools`, { method: 'POST', headers: headers() })
      replace(res.server)
      return res.tools
    } catch (err) {
      // The server stores why it failed; show it on the card.
      fetchServers()
      throw err
    }
  }

  async function approveTools(id: string, tools: string[]): Promise<McpServerView> {
    const server = await $fetch<McpServerView>(`/api/mcp/servers/${id}/approvals`, { method: 'PUT', headers: headers(), body: { tools } })
    replace(server)
    return server
  }

  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    servers.value = []
    loaded.value = false
    loading.value = false
    loadError.value = null
    unauthorized.value = false
  })

  return { servers, limits, loading, loaded, unauthorized, loadError, fetchServers, addServer, updateServer, removeServer, listTools, approveTools }
})
