<script setup lang="ts">
/** A whole page or the app is on its way. Shown only after a moment, so a quick page never flashes it. */
withDefaults(defineProps<{ fill?: 'screen' | 'parent' }>(), { fill: 'parent' })
</script>

<template>
  <div
    class="flex items-center justify-center bg-default"
    :class="fill === 'screen' ? 'h-screen w-screen' : 'w-full h-full'"
    role="status"
    aria-label="Loading"
  >
    <!-- The fade and the spin each need their own element: both set `animation`, and the later one wins. -->
    <span class="show-late flex">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </span>
  </div>
</template>
