import { createSharedComposable } from '@vueuse/core'
import { ref, computed } from 'vue'
import type { UserSession } from '../../server/utils/session'
import { $fetch } from 'ofetch'
import { useCsrf } from './useCsrf'

export const useUserSession = createSharedComposable(() => {
  const session = ref<UserSession | null>(null)
  const { csrf, setCsrf, headerName } = useCsrf()

  const clearSession = async () => {
    const token = csrf()
    const headers: Record<string, string> = {}
    if (token) {
      headers[headerName] = token
    }
    await $fetch('/api/session', {
      method: 'DELETE',
      headers
    }).catch(() => {})
    session.value = null
  }

  const fetchSession = async () => {
    try {
      const res = await $fetch.raw<UserSession>('/api/session')
      session.value = res._data || null
      const respCsrf = res.headers.get(headerName)
      if (respCsrf) {
        setCsrf(respCsrf)
      }
    } catch {
      session.value = null
    }
  }

  return {
    loggedIn: computed(() => Boolean(session.value?.user)),
    user: computed(() => session.value?.user || null),
    session,
    fetchSession,
    clearSession,
  }
})
