<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'

const route = useRoute()
useHead({ title: 'Page not found · OpenLobs' })
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex items-center justify-center px-6 bg-default">
    <div class="w-full max-w-sm text-center">
      <div class="mx-auto mb-6 size-14 rounded-2xl border border-default bg-elevated/50 shadow-sm flex items-center justify-center">
        <UIcon name="i-lucide-compass" class="size-7 text-muted" />
      </div>
      <p class="text-xs font-medium tracking-widest text-dimmed mb-2">404</p>
      <h1 class="text-2xl font-semibold tracking-tight text-highlighted mb-2">This page does not exist</h1>
      <p class="text-sm text-muted leading-relaxed mb-6 break-words">
        Nothing lives at <span class="font-mono text-xs text-default">{{ route.path }}</span>. It may have moved, or the link may be mistyped.
      </p>
      <div class="flex items-center justify-center gap-2">
        <UButton label="New chat" icon="i-lucide-message-circle-plus" color="neutral" to="/" />
        <UButton label="Workflows" icon="i-lucide-workflow" color="neutral" variant="subtle" to="/workflows" />
      </div>
    </div>
  </div>
</template>
