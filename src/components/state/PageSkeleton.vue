<script setup lang="ts">
/**
 * What a list page shows while it loads: the same shape as what is coming, so nothing jumps when it arrives.
 * It appears only if the wait is long enough to notice, so a quick load shows nothing extra at all.
 */
withDefaults(defineProps<{ shape?: 'cards' | 'rows', count?: number }>(), { shape: 'cards', count: 4 })
</script>

<template>
  <div
    class="show-late"
    role="status"
    aria-busy="true"
    aria-label="Loading"
  >
    <div v-if="shape === 'cards'" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div v-for="i in count" :key="i" class="rounded-2xl border border-default p-5">
        <USkeleton class="size-10 rounded-xl mb-4" />
        <USkeleton class="h-4 w-1/2 mb-2" />
        <USkeleton class="h-3 w-full mb-1.5" />
        <USkeleton class="h-3 w-2/3 mb-5" />
        <div class="flex gap-2">
          <USkeleton class="h-8 w-16 rounded-md" />
          <USkeleton class="h-8 w-16 rounded-md" />
        </div>
      </div>
    </div>
    <div v-else class="space-y-3">
      <div v-for="i in count" :key="i" class="flex items-center gap-3 rounded-2xl border border-default p-4">
        <USkeleton class="size-9 rounded-lg shrink-0" />
        <div class="flex-1 space-y-2">
          <USkeleton class="h-3.5 w-1/3" />
          <USkeleton class="h-3 w-3/4" />
        </div>
      </div>
    </div>
    <span class="sr-only">Loading</span>
  </div>
</template>
