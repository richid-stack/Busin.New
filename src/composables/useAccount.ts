import { ref } from 'vue'
import { $fetch } from 'ofetch'
import type { UsageSnapshot } from '../types/account'
import { useCsrf } from './useCsrf'

/** The signed-in person's usage, data export and account deletion. */
export function useAccount() {
  const usage = ref<UsageSnapshot | null>(null)
  const usageError = ref<string | null>(null)
  const loadingUsage = ref(false)
  const { csrf, headerName } = useCsrf()

  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }

  async function fetchUsage() {
    loadingUsage.value = true
    usageError.value = null
    try {
      usage.value = await $fetch<UsageSnapshot>('/api/usage', { headers: headers() })
    } catch (err: any) {
      usageError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your usage.'
    } finally {
      loadingUsage.value = false
    }
  }

  /** Downloads everything as a JSON file. */
  async function downloadExport() {
    const data = await $fetch<Record<string, unknown>>('/api/account/export', { headers: headers() })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `openlobs-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function deleteAccount() {
    return await $fetch<{ success: boolean }>('/api/account', { method: 'DELETE', headers: headers(), body: { confirm: 'DELETE' } })
  }

  return { usage, usageError, loadingUsage, fetchUsage, downloadExport, deleteAccount }
}
