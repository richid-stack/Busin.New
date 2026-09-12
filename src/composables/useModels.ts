import { useStorage } from '@vueuse/core'
import { MODELS } from '../../shared/utils/models'

export function useModels() {
  const defaultModel = 'google/gemini-3.5-flash'
  const model = useStorage<string>('model', defaultModel)

  if (!MODELS.some(m => m.value === model.value)) {
    model.value = defaultModel
  }

  return {
    models: MODELS,
    model
  }
}
