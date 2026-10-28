<script setup lang="ts">
import { computed } from 'vue'

/**
 * The microphone that lives where Send does. With nothing typed it is the way to talk; the moment there is text the
 * page swaps it for Send. While Lobby is on it shows what is happening and one tap does the obvious thing:
 * listening → done talking, speaking or working → stop, quiet → listen.
 */
const props = withDefaults(defineProps<{
  state?: 'off' | 'idle' | 'listening' | 'thinking' | 'speaking'
  /** 0 to 1, how loud the person is, shown as a soft ring. */
  level?: number
  loading?: boolean
}>(), { state: 'off', level: 0, loading: false })
defineEmits<{ press: [] }>()

const icon = computed(() => (props.state === 'thinking' || props.state === 'speaking' ? 'i-lucide-square' : 'i-lucide-mic'))
const label = computed(() => ({
  off: 'Talk to Lobby',
  idle: 'Start talking',
  listening: 'Done talking, send',
  thinking: 'Stop',
  speaking: 'Stop'
})[props.state])
const live = computed(() => props.state !== 'off' && props.state !== 'idle')
</script>

<template>
  <UTooltip :text="label">
    <UButton
      :icon="icon"
      :color="live ? 'primary' : 'neutral'"
      :variant="live ? 'solid' : 'soft'"
      :loading="loading"
      size="sm"
      class="voice-btn rounded-full"
      :class="{ 'voice-btn--listening': state === 'listening' }"
      :style="{ '--level': String(level) }"
      :aria-label="label"
      :aria-pressed="live"
      @click="$emit('press')"
    />
  </UTooltip>
</template>

<style scoped>
.voice-btn { transition: box-shadow 0.12s ease-out, background-color 0.2s; }
.voice-btn--listening {
  box-shadow: 0 0 0 calc(2px + var(--level, 0) * 9px) color-mix(in oklab, var(--ui-primary) 28%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .voice-btn { transition: none; }
}
</style>
