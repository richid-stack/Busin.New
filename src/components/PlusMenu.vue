<script setup lang="ts">
import type { PlusMenuItem } from '../composables/usePlusMenu'

/** The round + of a message box and the menu it opens. A small blue dot says a workspace or an agent is on. */
defineProps<{ items: PlusMenuItem[][], active?: boolean, id?: string, side?: 'top' | 'bottom' }>()
</script>

<template>
  <span class="relative">
    <UDropdownMenu :items="items" :content="{ align: 'start', side: side ?? 'top', collisionPadding: 12 }" :ui="{ content: 'w-72' }">
      <UButton
        :id="id"
        icon="i-lucide-plus"
        class="rounded-full shrink-0 cursor-pointer transition-transform hover:rotate-90 shadow-sm"
        variant="soft"
        color="primary"
        size="sm"
        aria-label="Add files, pick a workspace or an agent"
        title="Add files, pick a workspace or an agent"
      />
      <template #item-trailing="{ item }">
        <span v-if="(item as PlusMenuItem).suffix" class="ms-auto max-w-32 truncate text-xs text-muted">{{ (item as PlusMenuItem).suffix }}</span>
        <UIcon v-if="(item as any).children" name="i-lucide-chevron-right" class="size-4 text-dimmed" />
      </template>
    </UDropdownMenu>
    <span v-if="active" class="pointer-events-none absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-default" aria-hidden="true" />
  </span>
</template>
