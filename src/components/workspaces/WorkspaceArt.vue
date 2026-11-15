<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * The hand-drawn lighthouse shown in an empty workspace. About 80 KB, so it loads only when an empty
 * workspace is on screen. It takes its colours from the app: ink from the muted text, wash from the primary colour.
 */
const svg = ref('')
onMounted(async () => {
  try {
    svg.value = (await import('../../assets/art/lighthouse.svg?raw')).default
  } catch { /* the page reads fine without the picture */ }
})
</script>

<template>
  <div class="workspace-art" aria-hidden="true" v-html="svg" />
</template>

<style>
.workspace-art { --ink: var(--ui-text-muted); --sea-bg: var(--ui-bg); --wash-a: var(--ui-primary); }
.workspace-art svg { width: 100%; height: auto; display: block; }
</style>
