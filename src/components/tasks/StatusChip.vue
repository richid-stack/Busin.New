<script setup lang="ts">
// One neutral mono chip for every status. The word says the state; weight says how much it matters:
// calm states are quiet, the one that needs the person is inverted, a failure is the only red (text and a hairline).
export type ChipTone = 'quiet' | 'calm' | 'needs' | 'failed'

defineProps<{ label: string, tone?: ChipTone }>()

const TONE: Record<ChipTone, string> = {
  quiet: 'bg-elevated text-muted ring-default',
  calm: 'bg-elevated text-highlighted ring-default',
  needs: 'bg-inverted text-inverted ring-transparent',
  failed: 'bg-transparent text-error ring-error/40'
}
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-medium uppercase leading-4 tracking-wider ring-1 ring-inset"
    :class="TONE[tone ?? 'calm']"
  >{{ label }}</span>
</template>
