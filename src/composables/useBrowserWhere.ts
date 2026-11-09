import { ref } from 'vue'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'

export interface BrowserWhereInfo { where: 'cloud' | 'computer', computer: { ready: boolean, name: string | null, note: string } }

/** Where the assistant's browser runs: the cloud, or the person's own computer through the Bridge. */
export function useBrowserWhere() {
  const info = ref<BrowserWhereInfo | null>(null)
  const { csrf, headerName } = useCsrf()
  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }
  async function fetchBrowserWhere() {
    try { info.value = await $fetch<BrowserWhereInfo>('/api/account/browser', { headers: headers() }) } catch { info.value = null }
  }
  async function setBrowserWhere(where: 'cloud' | 'computer') {
    await $fetch('/api/account/browser', { method: 'PUT', headers: headers(), body: { where } })
    if (info.value) info.value = { ...info.value, where }
  }
  return { browserWhere: info, fetchBrowserWhere, setBrowserWhere }
}
