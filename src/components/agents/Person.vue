<script setup lang="ts">
import { computed } from 'vue'
import { personById } from '../../../shared/mascots'
import type { Mood } from './Creature.vue'

// A person mascot: a lady or a man, drawn in the same flat, rounded style as the creatures. The mood shows in the eyes,
// brows and mouth.
const props = withDefaults(defineProps<{ id: string, mood?: Mood, size?: number }>(), { mood: 'idle', size: 64 })
const p = computed(() => personById(props.id) ?? personById('ama')!)
const INK = '#18181b'
const tilt = computed(() => (props.mood === 'asking' ? 'rotate(-5 48 66)' : undefined))
const shade = computed(() => `color-mix(in srgb, ${p.value.skin} 82%, #000)`)
const mouth = computed(() => ({
  idle: 'M42 55 Q48 58 54 55',
  asking: 'M42 56 Q48 56 54 54',
  working: 'M43 56 H53',
  done: 'M41 54 Q48 62 55 54'
}[props.mood]))
</script>

<template>
  <svg viewBox="0 0 96 96" :width="size" :height="size" role="img" :aria-label="`${p.name}, ${mood}`" class="shrink-0 overflow-visible">
    <g :transform="tilt">
      <!-- hair behind the head -->
      <template v-if="p.style === 'braids'">
        <rect x="27" y="34" width="9" height="46" rx="4.5" :fill="p.hair" />
        <rect x="60" y="34" width="9" height="46" rx="4.5" :fill="p.hair" />
      </template>
      <circle v-if="p.style === 'puff'" cx="48" cy="19" r="17" :fill="p.hair" />
      <template v-if="p.style === 'locs'">
        <rect v-for="(x, i) in [28, 33, 59, 64]" :key="i" :x="x" y="30" width="5" :height="22 + (i % 2) * 7" rx="2.5" :fill="p.hair" />
      </template>

    </g>
    <!-- shoulders and neck stay put; only the head tilts -->
    <g>
      <path d="M10 96 C10 76 28 68 48 68 C68 68 86 76 86 96 Z" :fill="p.cloth" />
      <path v-if="p.accent && p.style !== 'wrap'" d="M30 71 C38 76 58 76 66 71" fill="none" :stroke="p.accent" stroke-width="3" stroke-linecap="round" />
      <path d="M41 58 H55 V70 C52 74 44 74 41 70 Z" :fill="shade" />
      <path d="M40 69 C44 76 52 76 56 69" fill="none" :stroke="p.skin" stroke-width="4" stroke-linecap="round" />

    </g>
    <g :transform="tilt">
      <!-- head -->
      <circle cx="31" cy="45" r="3.6" :fill="p.skin" />
      <circle cx="65" cy="45" r="3.6" :fill="p.skin" />
      <circle v-if="p.earrings" cx="31" cy="51" r="1.8" fill="#D9A441" />
      <circle v-if="p.earrings" cx="65" cy="51" r="1.8" fill="#D9A441" />
      <ellipse cx="48" cy="43" rx="17.5" ry="20" :fill="p.skin" />

      <!-- hair on top -->
      <path v-if="p.style === 'puff' || p.style === 'braids'" d="M30 40 C28 24 38 20 48 20 C58 20 68 24 66 40 C62 31 56 29 48 29 C40 29 34 31 30 40 Z" :fill="p.hair" />
      <path v-if="p.style === 'short'" d="M30 41 C28 22 38 19 48 19 C58 19 68 22 66 41 C62 32 56 30 48 30 C40 30 34 32 30 41 Z" :fill="p.hair" />
      <path v-if="p.style === 'locs'" d="M30 41 C28 22 38 18 48 18 C58 18 68 22 66 41 C62 31 56 29 48 29 C40 29 34 31 30 41 Z" :fill="p.hair" />
      <path v-if="p.style === 'fade'" d="M31 38 C30 25 38 22 48 22 C58 22 66 25 65 38 C61 31 55 30 48 30 C41 30 35 31 31 38 Z" :fill="p.hair" />
      <template v-if="p.style === 'wrap'">
        <path d="M27 38 C24 18 42 8 56 11 C72 14 74 30 68 40 C60 31 38 31 27 38 Z" :fill="p.accent || '#D9A441'" />
        <path d="M33 30 C42 24 56 24 64 30 M30 36 C40 28 58 28 67 36" fill="none" :stroke="p.cloth" stroke-width="2" stroke-linecap="round" opacity="0.55" />
        <path d="M60 14 C70 4 80 8 78 18 C74 14 68 14 64 18 Z" :fill="p.accent || '#D9A441'" />
      </template>

      <!-- beard -->
      <path v-if="p.beard" d="M31 48 C32 64 40 68 48 68 C56 68 64 64 65 48 C62 57 56 59 48 59 C40 59 34 57 31 48 Z" :fill="p.hair" />

      <!-- brows, eyes, nose, mouth -->
      <path :d="mood === 'asking' ? 'M36 36 Q41 33 45 35 M51 35 Q56 32 60 35' : 'M36 37 Q41 35 45 37 M51 37 Q56 35 60 37'" fill="none" :stroke="p.hair" stroke-width="2" stroke-linecap="round" />
      <template v-if="mood === 'done'">
        <path d="M37 44 Q41 40 45 44 M51 44 Q55 40 59 44" fill="none" :stroke="INK" stroke-width="2" stroke-linecap="round" />
      </template>
      <template v-else-if="mood === 'working'">
        <ellipse cx="41" cy="45" rx="2.6" ry="1.5" :fill="INK" />
        <ellipse cx="55" cy="45" rx="2.6" ry="1.5" :fill="INK" />
      </template>
      <template v-else>
        <circle :cx="41 + (mood === 'asking' ? 0.8 : 0)" cy="44" r="2.5" :fill="INK" />
        <circle :cx="55 + (mood === 'asking' ? 0.8 : 0)" cy="44" r="2.5" :fill="INK" />
        <circle :cx="41.9 + (mood === 'asking' ? 0.8 : 0)" cy="43" r="0.8" fill="#fff" />
        <circle :cx="55.9 + (mood === 'asking' ? 0.8 : 0)" cy="43" r="0.8" fill="#fff" />
      </template>
      <template v-if="p.glasses">
        <circle cx="41" cy="44" r="6" fill="none" :stroke="INK" stroke-width="1.6" />
        <circle cx="55" cy="44" r="6" fill="none" :stroke="INK" stroke-width="1.6" />
        <path d="M47 44 H49" :stroke="INK" stroke-width="1.6" />
      </template>
      <path d="M48 46 Q46.5 51 48.5 51.5" fill="none" :stroke="shade" stroke-width="1.6" stroke-linecap="round" />
      <path :d="mouth" fill="none" :stroke="p.beard ? '#e9d9cc' : INK" stroke-width="2" stroke-linecap="round" />
    </g>
  </svg>
</template>
