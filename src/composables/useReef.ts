import { ref } from 'vue'
import { $fetch } from 'ofetch'
import type { ReefScan, SharedItem } from '../types/reef'
import type { AgentProfile } from '../types/agents'
import { useCsrf } from './useCsrf'

const message = (err: any, fallback: string) => err?.data?.statusMessage || err?.data?.message || err?.statusMessage || fallback

export class BlockedShare extends Error {
  constructor(message: string, readonly scan: ReefScan) { super(message) }
}

/** The path a shared page lives at, and the full address to send to someone. */
export const sharePath = (id: string) => `/reef/${id}`
export const shareUrl = (id: string) => `${window.location.origin}${sharePath(id)}`

export function useReef() {
  const { csrf, headerName } = useCsrf()
  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }

  const mine = ref<SharedItem[]>([])
  const mineLoaded = ref(false)

  async function fetchMine() {
    try {
      const list = await $fetch<SharedItem[]>('/api/shares', { headers: headers() })
      mine.value = Array.isArray(list) ? list : []
    } catch {
      mine.value = []
    } finally {
      mineLoaded.value = true
    }
  }

  /** Shares an agent (or publishes a new version). A blocked one throws BlockedShare with the findings. */
  async function share(agentId: string): Promise<SharedItem> {
    try {
      const item = await $fetch<SharedItem>('/api/shares', { method: 'POST', headers: headers(), body: { agentId } })
      mine.value = mine.value.some(s => s.id === item.id) ? mine.value.map(s => (s.id === item.id ? { ...item, agentId } : s)) : [{ ...item, agentId }, ...mine.value]
      return item
    } catch (err: any) {
      const scan = err?.data?.data?.scan as ReefScan | undefined
      if (scan) throw new BlockedShare(message(err, 'This cannot be shared yet.'), scan)
      throw new Error(message(err, 'Could not share. Try again.'))
    }
  }

  async function unshare(id: string) {
    try {
      await $fetch(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() })
    } catch (err: any) {
      throw new Error(message(err, 'Could not stop sharing. Try again.'))
    }
    mine.value = mine.value.filter(s => s.id !== id)
  }

  async function getShare(id: string): Promise<SharedItem> {
    try {
      return await $fetch<SharedItem>(`/api/shares/${encodeURIComponent(id)}`, { headers: headers() })
    } catch (err: any) {
      const e = new Error(message(err, 'Could not load this page.')) as Error & { notFound?: boolean }
      e.notFound = (err?.statusCode ?? err?.status) === 404
      throw e
    }
  }

  async function install(id: string, allow: string[]): Promise<{ agent: AgentProfile, withheld: Array<{ id: string, label: string }>, droppedSkills: string[] }> {
    try {
      return await $fetch(`/api/shares/${encodeURIComponent(id)}/install`, { method: 'POST', headers: headers(), body: { allow } })
    } catch (err: any) {
      throw new Error(message(err, 'Could not install. Try again.'))
    }
  }

  async function report(id: string, reason: string, note: string) {
    try {
      await $fetch(`/api/shares/${encodeURIComponent(id)}/report`, { method: 'POST', headers: headers(), body: { reason, note } })
    } catch (err: any) {
      throw new Error(message(err, 'Could not send the report. Try again.'))
    }
  }

  return { mine, mineLoaded, fetchMine, share, unshare, getShare, install, report }
}
