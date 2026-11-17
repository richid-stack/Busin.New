import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { DEFAULT_PREFERENCES, exactTime, parsePreferences } from '../utils/preferences'
import type { Preferences } from '../utils/preferences'
import { timeAgo } from '../utils/taskTime'
import { whenUsed } from '../utils/workspaceIcons'

const KEY = 'openlobs.preferences'

function read(): Preferences {
  try { return parsePreferences(localStorage.getItem(KEY)) } catch { return { ...DEFAULT_PREFERENCES } }
}

/** Settings > Defaults for this device: the model new chats start with, what Enter does, how times read. */
export const usePreferences = createSharedComposable(() => {
  const prefs = ref<Preferences>(read())
  watch(prefs, (p) => {
    try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private window: the choice lasts until the tab closes */ }
  }, { deep: true })

  /** Short times for task lists ("2 h ago" or "14:05"). */
  const ago = (iso: string | null | undefined) => prefs.value.timeStyle === 'exact' ? exactTime(iso) : timeAgo(iso)
  /** The longer "2 minutes ago" wording workspace lists use. */
  const used = (iso: string) => prefs.value.timeStyle === 'exact' ? exactTime(iso) : whenUsed(iso)
  const reset = () => { prefs.value = { ...DEFAULT_PREFERENCES } }

  return { prefs, ago, used, reset }
})
