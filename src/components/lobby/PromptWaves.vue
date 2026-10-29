<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useElementSize, useEventListener, usePreferredReducedMotion } from '@vueuse/core'
import type { LobbyController } from '../../composables/useLobby'
import LobbyMark from './LobbyMark.vue'

/**
 * Voice mode, in the message box. While Lobby is on, the text box becomes a live waveform: it follows your voice while
 * you talk, ripples while Lobby works, and moves in a different colour while Lobby speaks. Above it, one line says
 * what is happening and shows the words just heard. Everything said is in the chat itself.
 */
const props = defineProps<{ lobby: LobbyController }>()

const label = computed(() => ({ listening: 'Listening', thinking: 'Working on it', speaking: 'Speaking', idle: 'Paused' })[props.lobby.state])
const caption = computed(() => {
  if (props.lobby.notice) return props.lobby.notice
  if (props.lobby.pending) return 'Say yes or no, or use the buttons above.'
  if (props.lobby.state === 'listening' && props.lobby.heard) return props.lobby.heard
  if (props.lobby.state === 'speaking' && props.lobby.now) return props.lobby.now
  if (props.lobby.state === 'listening') return 'Say what you need.'
  if (props.lobby.state === 'idle') return 'Tap the waveform to talk.'
  return props.lobby.heard
})
/** The real loudness behind the mark and the waves: yours while it listens, Lobby's while it speaks. */
const signal = computed(() => (props.lobby.state === 'speaking' ? props.lobby.outLevel : props.lobby.level))
const italic = computed(() => props.lobby.state === 'listening' && Boolean(props.lobby.heard) && !props.lobby.notice)

// The bars: as many as fit, each moving to its own rhythm. Pure drawing, no data.
const holder = useTemplateRef<HTMLElement>('holder')
const { width } = useElementSize(holder)
const GAP = 8
const count = computed(() => Math.max(12, Math.floor((width.value || 320) / GAP)))
const heights = ref<number[]>([])
const reduced = usePreferredReducedMotion()

let raf = 0
function frame(t: number) {
  const n = count.value
  const state = props.lobby.state
  const level = signal.value
  const next = heights.value.length === n ? heights.value.slice() : Array.from({ length: n }, () => 0.08)
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1)
    // Taller in the middle, so the line has a shape rather than a flat fence.
    const envelope = 0.3 + 0.7 * Math.sin(Math.PI * x)
    let target = 0.07
    if (state === 'listening') target = 0.08 + envelope * (0.2 + level * 0.85) * (0.55 + 0.45 * Math.sin(t / 150 + i * 0.7))
    else if (state === 'speaking') target = 0.08 + envelope * (0.12 + level * 0.78) * (0.5 + 0.5 * Math.sin(t / 210 + i * 0.5)) * (0.72 + 0.28 * Math.sin(t / 640 + i * 1.3))
    else if (state === 'thinking') target = 0.08 + envelope * 0.14 + 0.34 * Math.max(0, Math.sin(t / 520 - i * 0.3)) ** 3
    next[i] = next[i]! + (target - next[i]!) * 0.22
  }
  heights.value = next
  raf = requestAnimationFrame(frame)
}
onMounted(() => { if (reduced.value !== 'reduce') raf = requestAnimationFrame(frame) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const H = 40
const bars = computed(() => {
  const n = count.value
  const w = width.value || 320
  const step = w / n
  const still = reduced.value === 'reduce'
  return Array.from({ length: n }, (_, i) => {
    const h = Math.max(4, (still ? (props.lobby.state === 'idle' ? 0.1 : 0.35) : (heights.value[i] ?? 0.08)) * H)
    return { x: i * step + (step - 4) / 2, y: (H - h) / 2, h }
  })
})

// The colour says who has the floor: you, Lobby, or neither.
const stops = computed(() => ({
  listening: ['#38bdf8', '#34d399'],
  speaking: ['#a78bfa', '#f472b6'],
  thinking: ['#a1a1aa', '#d4d4d8'],
  idle: ['#d4d4d8', '#d4d4d8']
})[props.lobby.state])

useEventListener(window, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') props.lobby.hide() })
</script>

<template>
  <div
    class="-mb-2 w-full min-w-0 px-1 pb-1"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-2 text-xs">
      <span class="inline-flex shrink-0 items-center gap-1.5 font-medium text-highlighted">
        <LobbyMark
          :size="30"
          :state="lobby.state"
          :level="signal"
        />{{ label }}
      </span>
      <span
        class="min-w-0 flex-1 truncate text-muted"
        :class="{ italic }"
      >{{ caption }}</span>
    </div>
    <div
      ref="holder"
      class="relative mt-1 h-10 w-full overflow-hidden"
      aria-hidden="true"
    >
      <svg
        :width="width || 320"
        :height="H"
        :viewBox="`0 0 ${width || 320} ${H}`"
        class="absolute inset-0 block"
      >
        <defs>
          <linearGradient
            id="lobby-wave"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            :x2="width || 320"
            y2="0"
          >
            <stop
              offset="0"
              class="wave-stop"
              :style="{ stopColor: stops[0] }"
            />
            <stop
              offset="1"
              class="wave-stop"
              :style="{ stopColor: stops[1] }"
            />
          </linearGradient>
        </defs>
        <rect
          v-for="(b, i) in bars"
          :key="i"
          :x="b.x"
          :y="b.y"
          width="4"
          :height="b.h"
          rx="2"
          fill="url(#lobby-wave)"
        />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.wave-stop { transition: stop-color 0.8s ease; }
@media (prefers-reduced-motion: reduce) {
  .wave-stop { transition: none; }
}
</style>
