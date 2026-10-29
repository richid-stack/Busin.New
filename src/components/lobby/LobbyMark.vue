<script setup lang="ts">
import { computed } from 'vue'

/**
 * The OpenLobs lobster as Lobby's face, with one thin ring around it that is driven by real sound, not by a timer:
 * while it listens the ring is how loud you are (flat means it hears nothing), while it speaks it is how loud Lobby is,
 * while it works a short arc travels around, and when paused the ring is gone.
 */
const props = defineProps<{ state: 'idle' | 'listening' | 'thinking' | 'speaking', level: number }>()

const R = 10.5
const C = 2 * Math.PI * R
const sound = computed(() => props.state === 'listening' || props.state === 'speaking')
const arc = computed(() => {
  if (props.state === 'thinking') return 0.26 * C
  if (!sound.value) return 0
  return Math.max(0.05, Math.min(1, props.level * 1.2)) * C
})
const color = computed(() => ({ listening: '#34d399', speaking: '#a78bfa', thinking: 'var(--ui-text-muted)', idle: 'transparent' })[props.state])
</script>

<template>
  <span
    class="relative inline-grid size-6 shrink-0 place-items-center"
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 24 24"
      class="absolute inset-0 size-full -rotate-90"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        :r="R"
        stroke="currentColor"
        stroke-width="1.5"
        class="text-default transition-opacity duration-300"
        :class="state === 'idle' ? 'opacity-0' : 'opacity-10'"
      />
      <circle
        cx="12"
        cy="12"
        :r="R"
        :stroke="color"
        stroke-width="1.75"
        stroke-linecap="round"
        :stroke-dasharray="`${arc} ${C}`"
        class="ring"
        :class="{ 'ring--work': state === 'thinking' }"
      />
    </svg>
    <img
      src="/favicon.svg"
      alt=""
      class="size-3.5 transition-opacity duration-300"
      :class="state === 'idle' ? 'opacity-50' : 'opacity-100'"
    >
  </span>
</template>

<style scoped>
.ring { transition: stroke-dasharray 0.09s linear, stroke 0.4s ease; transform-origin: 12px 12px; }
.ring--work { animation: lobby-orbit 1.8s linear infinite; }
@keyframes lobby-orbit { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ring { transition: none; }
  .ring--work { animation: none; }
}
</style>
