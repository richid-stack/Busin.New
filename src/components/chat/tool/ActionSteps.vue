<script setup lang="ts">
defineProps<{ steps: Array<{ label: string, status: 'running' | 'done' | 'failed', detail?: string }> }>()
</script>

<template>
  <ol
    v-if="steps.length"
    class="space-y-1.5"
    aria-label="What it is doing"
  >
    <li
      v-for="(s, i) in steps"
      :key="i"
      class="flex items-start gap-2 text-xs leading-relaxed"
    >
      <UIcon
        :name="s.status === 'running' ? 'i-lucide-loader-2' : s.status === 'failed' ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
        class="size-3.5 mt-0.5 shrink-0"
        :class="s.status === 'running' ? 'animate-spin text-muted' : s.status === 'failed' ? 'text-error' : 'text-success'"
      />
      <span class="min-w-0">
        <span :class="s.status === 'failed' ? 'text-error' : 'text-default'">{{ s.label }}</span>
        <span
          v-if="s.detail"
          class="text-muted"
        > · {{ s.detail }}</span>
      </span>
    </li>
  </ol>
</template>
