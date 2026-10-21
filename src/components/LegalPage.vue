<script setup lang="ts">
import { LEGAL } from '../config/legal'

defineProps<{ title: string, intro: string }>()
</script>

<template>
  <div class="bg-default">
    <header class="max-w-3xl mx-auto px-4 sm:px-6 pt-6 flex items-center justify-between">
      <RouterLink to="/" class="flex items-center gap-1 rounded-md outline-primary/25 focus-visible:outline-3">
        <img src="/favicon.svg" alt="" class="size-6">
        <span class="text-lg font-bold text-highlighted">{{ LEGAL.product }}</span>
      </RouterLink>
      <div class="flex items-center gap-4 text-sm text-muted">
        <RouterLink to="/terms" class="hover:text-highlighted">Terms</RouterLink>
        <RouterLink to="/privacy" class="hover:text-highlighted">Privacy</RouterLink>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 sm:px-6 py-12 md:py-16">
      <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">{{ title }}</h1>
      <p class="text-muted text-base md:text-lg mb-2">{{ intro }}</p>
      <p class="text-xs text-dimmed mb-10">Last updated {{ LEGAL.updated }}</p>
      <div class="legal">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.legal :deep(h2) { font-size: 1.125rem; font-weight: 600; color: var(--ui-text-highlighted); margin: 2.25rem 0 0.75rem; letter-spacing: -0.01em; }
.legal :deep(p), .legal :deep(li) { font-size: 0.9375rem; line-height: 1.7; color: var(--ui-text-toned, var(--ui-text)); }
.legal :deep(p) { margin: 0 0 0.9rem; }
.legal :deep(ul) { list-style: disc; padding-left: 1.4rem; margin: 0 0 0.9rem; }
.legal :deep(li) { margin: 0.3rem 0; }
.legal :deep(a) { color: var(--ui-primary); text-decoration: underline; text-underline-offset: 3px; }
.legal :deep(strong) { color: var(--ui-text-highlighted); font-weight: 600; }
</style>
