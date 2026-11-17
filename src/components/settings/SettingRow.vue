<script setup lang="ts">
// One row in a settings list: what it is on the left, the control on the right. Hairlines come from the list around it.
defineProps<{ title: string, hint?: string, danger?: boolean }>()
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 py-4">
    <div class="min-w-0 flex-1 basis-56">
      <p class="text-sm font-medium" :class="danger ? 'text-error' : 'text-highlighted'">{{ title }}</p>
      <p v-if="hint || $slots.hint" class="mt-0.5 text-xs leading-snug text-muted"><slot name="hint">{{ hint }}</slot></p>
      <slot name="extra" />
    </div>
    <div v-if="$slots.default" class="flex shrink-0 flex-wrap items-center gap-1.5"><slot /></div>
  </div>
</template>
