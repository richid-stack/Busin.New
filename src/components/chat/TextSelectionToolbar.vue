<script setup lang="ts">
import { computed } from 'vue'
import { useTextSelection, useActiveElement } from '@vueuse/core'

const emit = defineEmits<{
  action: [action: string, text: string]
}>()

const { text, rects } = useTextSelection()
const activeElement = useActiveElement()

const show = computed(() => {
  if (!text.value || text.value.trim().length === 0 || rects.value.length === 0) return false
  
  // Do not show if the user is selecting text inside an input or textarea
  if (activeElement.value && ['INPUT', 'TEXTAREA'].includes(activeElement.value.tagName)) {
    return false
  }
  
  return true
})

const position = computed(() => {
  if (!show.value || rects.value.length === 0) return { top: '0px', left: '0px' }
  const rect = rects.value[0]
  if (!rect) return { top: '0px', left: '0px' }
  return {
    top: `${rect.top}px`,
    left: `${rect.left + (rect.width / 2)}px`
  }
})

const actions = [
  { label: 'Explain', icon: 'i-lucide-help-circle', action: 'Explain this:' },
  { label: 'Summarize', icon: 'i-lucide-align-left', action: 'Summarize this:' },
  { label: 'Quote', icon: 'i-lucide-quote', action: 'Quote:' }
]

function handleAction(action: string) {
  if (!text.value) return
  emit('action', action, text.value)
  // Clear selection
  window.getSelection()?.removeAllRanges()
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="show"
      class="fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
      :style="{ top: position.top, left: position.left }"
    >
      <div class="bg-default border border-default rounded-lg shadow-lg p-1 flex gap-1">
        <UButton
          v-for="a in actions"
          :key="a.label"
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="a.icon"
          :label="a.label"
          @click="handleAction(a.action)"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -80%);
}
.fade-enter-to,
.fade-leave-from {
  opacity: 1;
  transform: translate(-50%, -100%);
}
</style>
