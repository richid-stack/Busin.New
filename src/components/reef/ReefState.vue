<script setup lang="ts">
withDefaults(defineProps<{ icon?: string, title: string, text?: string, tone?: 'plain' | 'error' }>(), { icon: 'i-lucide-waves', text: '', tone: 'plain' })
</script>

<template>
  <div class="py-20 px-6 text-center">
    <div class="mx-auto mb-4 size-12 rounded-2xl border border-default bg-elevated/60 flex items-center justify-center">
      <UIcon :name="icon" class="size-5" :class="tone === 'error' ? 'text-error' : 'text-muted'" />
    </div>
    <p class="text-base font-semibold text-highlighted">{{ title }}</p>
    <p v-if="text" class="text-sm text-muted mt-1 max-w-sm mx-auto">{{ text }}</p>
    <div v-if="$slots.default" class="mt-5 flex justify-center gap-2"><slot /></div>
  </div>
</template>
