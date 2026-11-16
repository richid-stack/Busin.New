import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { appearanceAttributes, DEFAULT_APPEARANCE, parseAppearance } from '../utils/appearance'
import type { Appearance } from '../utils/appearance'

const KEY = 'openlobs.appearance'

function read(): Appearance {
  try { return parseAppearance(localStorage.getItem(KEY)) } catch { return { ...DEFAULT_APPEARANCE } }
}

/** How OpenLobs looks on this device: accent colour, text size, chat width, motion. Kept in this browser only. */
export const useAppearance = createSharedComposable(() => {
  const appearance = ref<Appearance>(read())

  const apply = (a: Appearance) => {
    if (typeof document === 'undefined') return
    for (const [name, value] of Object.entries(appearanceAttributes(a))) {
      if (value === null) document.documentElement.removeAttribute(name)
      else document.documentElement.setAttribute(name, value)
    }
  }
  apply(appearance.value)

  watch(appearance, (a) => {
    apply(a)
    try { localStorage.setItem(KEY, JSON.stringify(a)) } catch { /* private window: the choice lasts until the tab closes */ }
  }, { deep: true })

  const reset = () => { appearance.value = { ...DEFAULT_APPEARANCE } }

  return { appearance, reset }
})
