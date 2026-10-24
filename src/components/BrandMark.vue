<script setup lang="ts">
import { computed } from 'vue'

/** A brand's logo in a quiet rounded tile. Without a logo it shows the first letter, never a made-up mark. */
const props = withDefaults(defineProps<{ icon?: string, name: string, size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })

const box = computed(() => ({ sm: 'size-7 rounded-md', md: 'size-9 rounded-lg', lg: 'size-11 rounded-xl' })[props.size])
const glyph = computed(() => ({ sm: 'size-4', md: 'size-5', lg: 'size-6' })[props.size])
const letter = computed(() => (props.name.trim()[0] ?? '?').toUpperCase())
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center border border-default bg-elevated/60 text-default"
    :class="box"
    aria-hidden="true"
  >
    <UIcon
      v-if="icon"
      :name="icon"
      :class="glyph"
    />
    <span
      v-else
      class="text-sm font-semibold text-muted"
    >{{ letter }}</span>
  </span>
</template>
