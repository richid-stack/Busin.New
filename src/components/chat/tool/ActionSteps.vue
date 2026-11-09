<script setup lang="ts">
import { stepWords } from '../../../utils/stepWords'

defineProps<{ steps: Array<{ label: string, status: 'running' | 'done' | 'failed', detail?: string }> }>()
</script>

<template>
  <div
    v-if="steps.length"
    class="flex flex-col"
    aria-label="What it is doing"
  >
    <!-- Each step reads as a sentence. Its icon says what kind of action it is and stays put: only the words change as it runs. -->
    <UChatTool
      v-for="(s, i) in steps"
      :key="i"
      :text="stepWords(s.label, s.status).text"
      :suffix="s.detail"
      :streaming="s.status === 'running'"
      :icon="stepWords(s.label, s.status).icon"
      :ui="s.status === 'failed' ? { leadingIcon: 'text-error', label: 'text-error' } : undefined"
    />
  </div>
</template>
