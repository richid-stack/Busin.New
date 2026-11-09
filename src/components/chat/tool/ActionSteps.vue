<script setup lang="ts">
defineProps<{ steps: Array<{ label: string, status: 'running' | 'done' | 'failed', detail?: string }> }>()
</script>

<template>
  <div
    v-if="steps.length"
    class="flex flex-col"
    aria-label="What it is doing"
  >
    <!-- Each step is a small tool-call row, the same kind the rest of the chat shows. -->
    <UChatTool
      v-for="(s, i) in steps"
      :key="i"
      :text="s.label"
      :suffix="s.detail"
      :streaming="s.status === 'running'"
      :loading="s.status === 'running'"
      :icon="s.status === 'failed' ? 'i-lucide-circle-x' : 'i-lucide-check'"
      :ui="s.status === 'failed' ? { leadingIcon: 'text-error', label: 'text-error' } : undefined"
    />
  </div>
</template>
