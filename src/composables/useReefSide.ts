import { createSharedComposable } from '@vueuse/core'
import { ref } from 'vue'
import { useReef } from './useReef'
import type { ReefSide } from '../types/reef'

/** The right-hand column. Loaded once and kept for a minute, so moving between pages does not refetch it. */
export const useReefSide = createSharedComposable(() => {
  const api = useReef()
  const side = ref<ReefSide | null>(null)
  const failed = ref(false)
  let at = 0
  let inflight: Promise<void> | null = null

  async function load(force = false) {
    if (!force && side.value && Date.now() - at < 60_000) return
    if (inflight) return inflight
    inflight = (async () => {
      try {
        side.value = await api.side()
        failed.value = false
        at = Date.now()
      } catch {
        failed.value = true
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return { side, failed, load, drop: (handle: string) => { if (side.value) side.value = { ...side.value, people: side.value.people.filter(p => p.handle !== handle) } } }
})
