<script setup lang="ts">
import { computed } from 'vue'

/**
 * The circled waveform that lives where Send does. With nothing typed it starts voice mode; while voice mode is on it
 * shows what is happening and one tap does the obvious thing: listening → done talking, speaking or working → stop,
 * quiet → listen. The moment there is text the page swaps it for Send.
 */
const props = withDefaults(defineProps<{
  state?: 'off' | 'idle' | 'listening' | 'thinking' | 'speaking'
  /** 0 to 1, how loud the person is, shown as a soft ring. */
  level?: number
  loading?: boolean
}>(), { state: 'off', level: 0, loading: false })
defineEmits<{ press: [] }>()

const stop = computed(() => props.state === 'thinking' || props.state === 'speaking')
const label = computed(() => ({
  off: 'Talk to Lobby',
  idle: 'Start talking',
  listening: 'Done talking, send',
  thinking: 'Stop',
  speaking: 'Stop'
})[props.state])
</script>

<template>
  <UTooltip :text="label">
    <button
      type="button"
      class="voice-btn relative inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-inverted text-inverted shadow-sm outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-primary active:scale-95 disabled:opacity-60"
      :class="{ 'voice-btn--listening': state === 'listening' }"
      :style="{ '--level': String(level) }"
      :aria-label="label"
      :disabled="loading"
      @click="$emit('press')"
    >
      <UIcon
        v-if="loading"
        name="i-lucide-loader-circle"
        class="size-4 animate-spin"
      />
      <UIcon
        v-else-if="stop"
        name="i-lucide-square"
        class="size-3.5 fill-current"
      />
      <span
        v-else-if="state === 'listening'"
        class="flex h-4 items-center gap-[3px]"
        aria-hidden="true"
      >
        <i class="bar" /><i class="bar" /><i class="bar" /><i class="bar" />
      </span>
      <UIcon
        v-else
        name="i-lucide-audio-lines"
        class="size-[18px]"
      />
    </button>
  </UTooltip>
</template>

<style scoped>
.voice-btn--listening {
  box-shadow: 0 0 0 calc(2px + var(--level, 0) * 9px) color-mix(in oklab, var(--ui-primary) 30%, transparent);
  transition: box-shadow 0.12s ease-out, transform 0.15s;
}
.bar {
  display: block;
  width: 3px;
  height: 100%;
  border-radius: 2px;
  background: currentColor;
  transform-origin: center;
  animation: lobby-bar 1s ease-in-out infinite;
}
.bar:nth-child(2) { animation-delay: 0.15s; }
.bar:nth-child(3) { animation-delay: 0.3s; }
.bar:nth-child(4) { animation-delay: 0.45s; }
@keyframes lobby-bar {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .bar { animation: none; transform: scaleY(0.7); }
  .voice-btn--listening { transition: none; }
}
</style>
