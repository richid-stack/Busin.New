import { ref } from 'vue'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'
import { DEFAULT_POWERS } from '../../shared/powers'
import type { Power, Powers } from '../../shared/powers'

/** Settings > Powers: what the assistant may use at all. Kept in the account, so it follows the person to every device. */
export function usePowers() {
  const powers = ref<Powers | null>(null)
  const failed = ref(false)
  const { csrf, headerName } = useCsrf()
  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }
  async function fetchPowers() {
    try {
      powers.value = (await $fetch<{ powers: Powers }>('/api/account/powers', { headers: headers() })).powers
      failed.value = false
    } catch {
      failed.value = true
      powers.value = null
    }
  }
  /** Switches at once on screen and puts it back if the server says no. */
  async function setPower(key: Power, value: boolean) {
    const before = powers.value ?? { ...DEFAULT_POWERS }
    powers.value = { ...before, [key]: value }
    try {
      powers.value = (await $fetch<{ powers: Powers }>('/api/account/powers', { method: 'PUT', headers: headers(), body: { [key]: value } })).powers
    } catch (err) {
      powers.value = before
      throw err
    }
  }
  return { powers, failed, fetchPowers, setPower }
}
