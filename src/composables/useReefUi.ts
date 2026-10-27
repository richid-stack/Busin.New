import { createSharedComposable } from '@vueuse/core'
import { ref } from 'vue'
import type { AgentProfile } from '../types/agents'

/** Which Reef dialogs are open. Kept in one place so a button anywhere can open them. */
export const useReefUi = createSharedComposable(() => {
  const publishOpen = ref(false)
  const publishAgent = ref<AgentProfile | null>(null)
  const publishName = ref<string | null>(null)
  const askOpen = ref(false)
  const askProject = ref<string | null>(null)
  return {
    publishOpen,
    publishAgent,
    publishName,
    askOpen,
    askProject,
    /** `name` set: publish a new version of a project the person already shared. */
    openPublish: (agent: AgentProfile | null = null, name: string | null = null) => { publishAgent.value = agent; publishName.value = name; publishOpen.value = true },
    openAsk: (projectId: string | null = null) => { askProject.value = projectId; askOpen.value = true }
  }
})
