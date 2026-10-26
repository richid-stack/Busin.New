<script setup lang="ts">
import type { Person } from '../../reef/concept'

defineProps<{ person: Person, handle?: boolean }>()
</script>

<template>
  <span class="inline-flex items-center gap-1 min-w-0">
    <RouterLink :to="`/reef/u/${person.handle}`" class="font-semibold text-highlighted truncate hover:underline underline-offset-2">{{ person.name }}</RouterLink>
    <UIcon v-if="person.official" name="i-lucide-badge-check" class="size-4 shrink-0 text-primary" title="Made by OpenLobs" />
    <UIcon v-else-if="person.verified" name="i-lucide-badge-check" class="size-4 shrink-0 text-sky-500" title="Verified maker" />
    <span v-if="handle !== false" class="text-muted truncate">@{{ person.handle }}</span>
  </span>
</template>
