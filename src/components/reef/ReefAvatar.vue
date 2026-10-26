<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string, size?: number, square?: boolean }>(), { size: 40, square: false })

const PALETTE = [
  'from-sky-400 to-indigo-500', 'from-emerald-400 to-teal-600', 'from-amber-400 to-orange-600',
  'from-rose-400 to-pink-600', 'from-violet-400 to-purple-600', 'from-cyan-400 to-blue-600'
]
const tone = computed(() => PALETTE[(props.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length])
const initials = computed(() => (props.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join(''))
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center bg-gradient-to-br font-semibold text-white select-none"
    :class="[tone, square ? 'rounded-lg' : 'rounded-full']"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }"
    aria-hidden="true"
  >{{ initials }}</span>
</template>
