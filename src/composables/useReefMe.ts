import { createSharedComposable } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useFirebaseAuth } from './useFirebaseAuth'
import { useReef } from './useReef'
import { useUserSession } from './useUserSession'
import type { ReefMe, ReefProfile } from '../types/reef'

/**
 * Who the person is in The Reef: signed in or not, whether they have made a profile yet, and how many
 * alerts are waiting. One copy is shared by every Reef page. `requireProfile` is how a button asks
 * "may I do this as you?": it opens sign-in or the profile form if needed, then carries on with the action.
 */
export const useReefMe = createSharedComposable(() => {
  const api = useReef()
  const { loggedIn } = useUserSession()
  const { openAuthModal } = useFirebaseAuth()

  const me = ref<ReefMe | null>(null)
  const loaded = ref(false)
  const setupOpen = ref(false)
  let pending: (() => void | Promise<void>) | null = null

  async function load() {
    if (!loggedIn.value) { me.value = { signedIn: false, name: '', profile: null, unread: 0, admin: false }; loaded.value = true; return }
    try {
      const got = await api.me()
      // They signed out while this was loading: do not show a stale profile.
      if (!loggedIn.value) { me.value = { signedIn: false, name: '', profile: null, unread: 0, admin: false }; return }
      me.value = got
    } catch {
      me.value = { signedIn: true, name: '', profile: null, unread: 0, admin: false }
    } finally {
      loaded.value = true
    }
    // The person signed in because a button asked them to: carry on with what they were doing.
    if (pending && me.value?.signedIn) {
      if (me.value.profile) { const run = pending; pending = null; await run() } else setupOpen.value = true
    }
  }
  watch(loggedIn, () => { void load() }, { immediate: true })

  function setProfile(profile: ReefProfile) {
    me.value = { ...(me.value ?? { signedIn: true, name: '', unread: 0, admin: false }), signedIn: true, profile }
    setupOpen.value = false
    if (pending) { const run = pending; pending = null; void run() }
  }

  function cancelSetup() { pending = null; setupOpen.value = false }

  /** True when the person can act. Otherwise asks them to sign in or make a profile, and runs `then` afterwards. */
  function requireProfile(then?: () => void | Promise<void>): boolean {
    if (!loggedIn.value) { pending = then ?? null; openAuthModal(); return false }
    if (!me.value?.profile) { pending = then ?? null; setupOpen.value = true; return false }
    return true
  }

  return {
    me,
    loaded,
    profile: computed(() => me.value?.profile ?? null),
    unread: computed(() => me.value?.unread ?? 0),
    admin: computed(() => me.value?.admin === true),
    signedIn: loggedIn,
    setupOpen,
    reload: load,
    setProfile,
    cancelSetup,
    requireProfile,
    clearUnread: () => { if (me.value) me.value = { ...me.value, unread: 0 } }
  }
})
