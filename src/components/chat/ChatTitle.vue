<script setup lang="ts">
import { computed } from 'vue'

// The title is just the title: renaming, deleting and the rest live in the chat's three-dot menu.
const props = defineProps<{
  chatId: string
  title?: string | null
  isOwner: boolean
}>()

const displayTitle = computed(() => props.title || 'Untitled')
</script>

<template>
  <span
    class="text-sm font-medium truncate min-w-0 max-w-3xs sm:max-w-xs"
    :class="!isOwner || title ? 'text-highlighted' : 'text-muted'"
  >
    {{ displayTitle }}
  </span>
</template>
