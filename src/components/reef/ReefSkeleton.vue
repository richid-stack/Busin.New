<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <div aria-busy="true" aria-label="Loading">
    <div v-for="i in rows" :key="i" class="flex gap-3 px-4 py-4 border-b border-default">
      <USkeleton class="size-[42px] rounded-full shrink-0" />
      <div class="flex-1 space-y-2.5">
        <USkeleton class="h-3.5 w-40" />
        <USkeleton class="h-3.5 w-full" />
        <USkeleton class="h-3.5 w-2/3" />
      </div>
    </div>
  </div>
</template>
