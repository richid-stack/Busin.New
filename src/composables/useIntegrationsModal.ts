import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'

export const useIntegrationsModal = createSharedComposable(() => {
  const isIntegrationsModalOpen = ref(false)

  const openIntegrationsModal = () => {
    isIntegrationsModalOpen.value = true
  }

  const closeIntegrationsModal = () => {
    isIntegrationsModalOpen.value = false
  }

  return {
    isIntegrationsModalOpen,
    openIntegrationsModal,
    closeIntegrationsModal
  }
})
