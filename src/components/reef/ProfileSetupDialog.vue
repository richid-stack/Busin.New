<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import { useUserSession } from '../../composables/useUserSession'

const { setupOpen, setProfile, cancelSetup } = useReefMe()
const { user } = useUserSession()
const api = useReef()

const handle = ref('')
const name = ref('')
const bio = ref('')
const place = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(setupOpen, (o) => {
  if (!o) return
  error.value = null
  name.value = name.value || user.value?.name || ''
  handle.value = handle.value || (user.value?.name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '').replace(/^[^a-z]+/, '').slice(0, 20)
})

const clean = computed(() => handle.value.trim().replace(/^@/, '').toLowerCase())
const handleOk = computed(() => /^[a-z][a-z0-9_]{2,19}$/.test(clean.value))
const handleHint = computed(() => (clean.value && !handleOk.value ? '3 to 20 letters, numbers or underscores, starting with a letter.' : 'This is your address in The Reef. It cannot be changed later.'))

async function save() {
  if (!handleOk.value || !name.value.trim() || busy.value) return
  busy.value = true
  error.value = null
  try {
    setProfile(await api.createProfile({ handle: clean.value, name: name.value.trim(), bio: bio.value.trim(), place: place.value.trim() }))
  } catch (err: any) {
    error.value = err?.message || 'Could not save your profile.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal
    :open="setupOpen"
    title="Set up your Reef profile"
    description="This is what people see next to your posts and projects."
    @update:open="(o: boolean) => { if (!o) cancelSetup() }"
  >
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField label="Handle" required :help="handleHint" :error="clean && !handleOk ? ' ' : undefined">
          <UInput v-model="handle" class="w-full" maxlength="21" placeholder="ama" autocomplete="off" autocapitalize="none" spellcheck="false">
            <template #leading><span class="text-muted text-sm">@</span></template>
          </UInput>
        </UFormField>
        <UFormField label="Name" required>
          <UInput v-model="name" class="w-full" maxlength="50" placeholder="Ama Boateng" />
        </UFormField>
        <UFormField label="Bio" :help="`${160 - bio.length} characters left`">
          <UTextarea v-model="bio" class="w-full" :rows="2" maxlength="160" placeholder="What do you do, and what do you build?" />
        </UFormField>
        <UFormField label="Place">
          <UInput v-model="place" class="w-full" maxlength="40" placeholder="Accra, Ghana" />
        </UFormField>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
        <button type="submit" class="hidden" aria-hidden="true" tabindex="-1" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Not now" color="neutral" variant="ghost" @click="cancelSetup" />
        <UButton label="Create profile" color="neutral" :loading="busy" :disabled="!handleOk || !name.trim()" @click="save" />
      </div>
    </template>
  </UModal>
</template>
