<script setup lang="ts">
import { computed } from 'vue'

/** The small microphone beside the waveform: say it, and the words land in the message box. */
const props = defineProps<{ listening: boolean, working?: boolean }>()
defineEmits<{ press: [] }>()

const label = computed(() => (props.listening ? 'Stop dictating' : props.working ? 'Working out what you said' : 'Dictate: speak and I will type it'))
</script>

<template>
  <UTooltip :text="label">
    <UButton
      :icon="working ? 'i-lucide-loader-circle' : 'i-lucide-mic'"
      :color="listening ? 'primary' : 'neutral'"
      :variant="listening ? 'solid' : 'ghost'"
      size="sm"
      class="dictate-btn rounded-full"
      :class="{ 'dictate-btn--on': listening, '[&_svg]:animate-spin': working }"
      :aria-label="label"
      :aria-pressed="listening"
      :disabled="working"
      @click="$emit('press')"
    />
  </UTooltip>
</template>

<style scoped>
.dictate-btn--on { animation: dictate-ring 1.6s ease-out infinite; }
@keyframes dictate-ring {
  from { box-shadow: 0 0 0 0 color-mix(in oklab, var(--ui-primary) 45%, transparent); }
  to { box-shadow: 0 0 0 10px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .dictate-btn--on { animation: none; }
}
</style>
