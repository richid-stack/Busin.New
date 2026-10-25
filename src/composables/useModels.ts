import { computed, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { MODELS } from '../../shared/utils/models'
import { MY_PREFIX } from '../../shared/modelProviders'
import { useModelProviders } from './useModelProviders'
import { useUserSession } from './useUserSession'

export function useModels() {
  const defaultModel = 'google/gemini-3.5-flash'
  const model = useStorage<string>('model', defaultModel)
  const { myModels, myLoaded, fetchMyModels } = useModelProviders()
  const { loggedIn } = useUserSession()

  // A saved choice must still exist. Your own models are checked once the list has loaded; the built-in ones right away.
  if (!model.value.startsWith(MY_PREFIX) && !MODELS.some(m => m.value === model.value)) model.value = defaultModel

  if (loggedIn.value && !myLoaded.value) void fetchMyModels()
  watch(loggedIn, (on) => {
    if (on) void fetchMyModels()
    else if (model.value.startsWith(MY_PREFIX)) model.value = defaultModel
  })
  watch(() => [myLoaded.value, myModels.value] as const, ([loaded, mine]) => {
    if (loaded && model.value.startsWith(MY_PREFIX) && !mine.some(m => m.value === model.value)) model.value = defaultModel
  })

  /** Built-in models first, then each connected provider's models under its own heading. */
  const items = computed(() => {
    const out: any[] = MODELS.map(m => ({ label: m.label, value: m.value, icon: m.icon }))
    const byProvider = new Map<string, typeof myModels.value>()
    for (const m of myModels.value) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m])
    if (byProvider.size) {
      out.unshift({ type: 'label', label: 'Built in' })
      for (const [name, list] of byProvider) {
        out.push({ type: 'separator' }, { type: 'label', label: `${name} · your key` })
        out.push(...list.map(m => ({ label: m.label, value: m.value, icon: m.icon })))
      }
    }
    return out
  })
  const selected = computed(() => items.value.find(m => m.value === model.value))

  return {
    models: MODELS,
    items,
    selected,
    myModels,
    defaultModel,
    model
  }
}
