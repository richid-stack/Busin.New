<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { reportClientError } from '../../lib/errorReporting'
import StateCard from './StateCard.vue'

/**
 * Keeps one broken page from leaving the person with a blank screen. If a page fails while it is being built or
 * drawn, they see a short explanation and a way out, the rest of the app (the sidebar, their chats) keeps working,
 * and the error is reported like any other. A click handler that fails is not treated this way: the page is fine,
 * and that error still goes to the usual reporting.
 */
const failed = ref(false)
const route = useRoute()

const LIFECYCLE = /setup|render|mounted|updated|created|watcher|scheduler|async component|transition/i

onErrorCaptured((err, _instance, info) => {
  if (!LIFECYCLE.test(info)) return true
  console.error(err)
  reportClientError(err)
  failed.value = true
  return false
})

// Going somewhere else is a fresh start.
watch(() => route.fullPath, () => { failed.value = false })

function reload() { window.location.reload() }
</script>

<template>
  <div v-if="failed" class="flex-1 min-w-0 h-full flex items-center justify-center px-6 bg-default">
    <div class="w-full max-w-sm">
      <StateCard
        icon="i-lucide-triangle-alert"
        tone="error"
        title="This page hit a problem"
        text="What you already saved is safe. Try again, or reload the page. If it keeps happening, it has been reported to us."
      >
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" @click="failed = false" />
        <UButton label="Reload" color="neutral" variant="subtle" @click="reload" />
      </StateCard>
    </div>
  </div>
  <slot v-else />
</template>
