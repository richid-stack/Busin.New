import { ref } from 'vue'
import { useRefHistory } from '@vueuse/core'

const state = ref({ a: 1 })
const { undo, redo, canUndo, canRedo } = useRefHistory(state, { deep: true })
