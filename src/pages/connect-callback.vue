<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { INTEGRATION_AUTH_MESSAGE } from '../composables/useIntegrationConnect'

definePage({ meta: { layout: 'blank' } })

const route = useRoute()
const router = useRouter()

const attempt = typeof route.query.attempt === 'string' ? route.query.attempt : ''
const failed = ref(String(route.query.status || '').toLowerCase() === 'failed')
const handedOff = ref(false)

onMounted(() => {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(
      { type: INTEGRATION_AUTH_MESSAGE, status: failed.value ? 'failed' : 'success', attempt },
      window.location.origin
    )
    handedOff.value = true
    window.setTimeout(() => window.close(), failed.value ? 2500 : 900)
  }
})
</script>

<template>
  <main class="min-h-[100dvh] flex items-center justify-center px-6">
    <div class="w-full max-w-sm text-center">
      <div class="flex items-center justify-center gap-2 mb-8">
        <img src="/favicon.svg" alt="" class="size-6">
        <span class="text-base font-bold tracking-tight text-highlighted">OpenLobs</span>
      </div>
      <div
        class="mx-auto mb-6 size-14 rounded-2xl border border-default shadow-sm flex items-center justify-center"
        :class="failed ? 'bg-error/10' : 'bg-success/10'"
      >
        <UIcon
          :name="failed ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
          class="size-7"
          :class="failed ? 'text-error' : 'text-success'"
        />
      </div>

      <h1 class="text-xl font-semibold text-highlighted mb-2">
        {{ failed ? 'Connection not completed' : 'Connected' }}
      </h1>
      <p class="text-sm text-muted leading-relaxed">
        <template v-if="handedOff">
          {{ failed ? 'Closing this window. You can try again from Integrations.' : 'All set. This window will close on its own.' }}
        </template>
        <template v-else>
          {{ failed ? 'The authorization was not completed.' : 'Your app is connected.' }}
        </template>
      </p>

      <UButton
        v-if="!handedOff"
        label="Back to Integrations"
        color="neutral"
        class="mt-6"
        @click="router.replace('/integrations')"
      />
    </div>
  </main>
</template>
