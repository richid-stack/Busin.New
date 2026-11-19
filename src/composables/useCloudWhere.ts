import { ref } from 'vue'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'

export type CloudPlace = 'github' | 'box'
export interface GithubLastRun { at: string, seconds: number, minutes: number, ok: boolean }
export interface CloudOverview {
  github: { connected: boolean, login?: string, repo?: string, checkedAt?: string, lastRun?: GithubLastRun | null }
  /** What the person picked, if they did. */
  where: CloudPlace | null
  /** Where plans go right now. Null means nowhere yet. */
  chosen: CloudPlace | null
  /** Whether this app has its own cloud box. */
  box: boolean
}

/** Settings > Powers > "Where it runs": the person's own GitHub or the OpenLobs box. The token goes up once and is never sent back. */
export function useCloudWhere() {
  const overview = ref<CloudOverview | null>(null)
  const failed = ref(false)
  const { csrf, headerName } = useCsrf()
  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }
  async function fetchCloud() {
    try { overview.value = await $fetch<CloudOverview>('/api/cloud', { headers: headers() }); failed.value = false } catch { failed.value = true }
  }
  async function connectGithub(token: string) {
    overview.value = await $fetch<CloudOverview>('/api/cloud/github', { method: 'PUT', headers: headers(), body: { token } })
  }
  async function checkGithub() {
    overview.value = await $fetch<CloudOverview>('/api/cloud/github/check', { method: 'POST', headers: headers() })
  }
  async function disconnectGithub() {
    overview.value = await $fetch<CloudOverview>('/api/cloud/github', { method: 'DELETE', headers: headers() })
  }
  /** Switches at once on screen and puts it back if the server says no. */
  async function setWhere(where: CloudPlace) {
    const before = overview.value
    if (before) overview.value = { ...before, where, chosen: where }
    try { overview.value = await $fetch<CloudOverview>('/api/cloud/where', { method: 'PUT', headers: headers(), body: { where } }) } catch (err) { overview.value = before; throw err }
  }
  return { overview, failed, fetchCloud, connectGithub, checkGithub, disconnectGithub, setWhere }
}

/** The message a failed call carries, in the server's own words. */
export const cloudError = (err: any): string => err?.data?.statusMessage || err?.statusMessage || err?.message || 'Something went wrong. Try again.'
