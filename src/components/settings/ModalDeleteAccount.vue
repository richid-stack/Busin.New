<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useAccount } from '../../composables/useAccount'

const emit = defineEmits<{ close: [boolean] }>()

const { signInMethod, reauthenticate } = useFirebaseAuth()
const { deleteAccount } = useAccount()

const typed = ref('')
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const needsPassword = computed(() => signInMethod.value === 'password')
const ready = computed(() => typed.value.trim() === 'DELETE' && (!needsPassword.value || password.value.length > 0))

async function confirm() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    // A fresh sign-in first: deleting an account must not be possible from a session left open.
    await reauthenticate(password.value)
    await deleteAccount()
    emit('close', true)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || err?.message || 'Could not delete the account. Nothing was lost; try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal
    title="Delete your account?"
    description="This removes your account and everything in it, for good."
    :close="false"
    :dismissible="!busy"
    :ui="{ footer: 'flex-row-reverse justify-start' }"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="confirm">
        <ul class="text-sm text-muted list-disc pl-5 space-y-1">
          <li>Chats, workflows and their run history, agents, memory and created files.</li>
          <li>Your connected apps and MCP servers are disconnected.</li>
          <li>Your usage and plan records. This cannot be undone, so download your data first if you want a copy.</li>
        </ul>
        <UFormField label="Type DELETE to confirm">
          <UInput v-model="typed" class="w-full" placeholder="DELETE" autocomplete="off" aria-label="Type DELETE to confirm" />
        </UFormField>
        <UFormField v-if="needsPassword" label="Your password" description="We ask again to be sure it is you.">
          <UInput v-model="password" class="w-full" type="password" autocomplete="current-password" aria-label="Your password" />
        </UFormField>
        <p v-else class="text-xs text-muted">You will be asked to sign in again to confirm it is you.</p>
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
        <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
      </form>
    </template>
    <template #footer>
      <UButton color="error" label="Delete everything" icon="i-lucide-trash-2" :loading="busy" :disabled="!ready" @click="confirm" />
      <UButton color="neutral" variant="ghost" label="Cancel" :disabled="busy" @click="emit('close', false)" />
    </template>
  </UModal>
</template>
