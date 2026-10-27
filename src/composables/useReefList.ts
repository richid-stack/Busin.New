import { ref } from 'vue'
import type { Ref } from 'vue'
import { ReefApiError } from './useReef'

/**
 * A list that loads a page at a time: first load, "load more", and an error you can retry. Only the newest
 * request may change the list, so switching tabs quickly never shows the old tab's results.
 */
export function useReefList<T extends { id?: string }>(fetchPage: (before: string | undefined) => Promise<{ items: T[], next: string | null }>) {
  const items = ref([]) as Ref<T[]>
  const next = ref<string | null>(null)
  const loading = ref(true)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  let seq = 0

  async function load() {
    const mine = ++seq
    loading.value = true
    error.value = null
    try {
      const page = await fetchPage(undefined)
      if (mine !== seq) return
      items.value = page.items
      next.value = page.next
    } catch (err) {
      if (mine !== seq) return
      error.value = err instanceof ReefApiError ? err.message : 'Could not load. Try again.'
      items.value = []
      next.value = null
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  async function more() {
    if (!next.value || loadingMore.value) return
    const mine = seq
    loadingMore.value = true
    try {
      const page = await fetchPage(next.value)
      if (mine !== seq) return
      const have = new Set(items.value.map(i => i.id))
      items.value = [...items.value, ...page.items.filter(i => !i.id || !have.has(i.id))]
      next.value = page.next
    } catch (err) {
      error.value = err instanceof ReefApiError ? err.message : 'Could not load more.'
    } finally {
      loadingMore.value = false
    }
  }

  return { items, next, loading, loadingMore, error, load, more }
}
