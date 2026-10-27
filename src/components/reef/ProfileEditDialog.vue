<script setup lang="ts">
import { ref, watch } from 'vue'
import { useReef } from '../../composables/useReef'
import type { ReefProfile } from '../../types/reef'

const props = defineProps<{ profile: ReefProfile }>()
const emit = defineEmits<{ saved: [profile: ReefProfile] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useReef()
const toast = useToast()
const name = ref('')
const bio = ref('')
const place = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
watch(open, (o) => { if (o) { name.value = props.profile.name; bio.value = props.profile.bio; place.value = props.profile.place; error.value = null } })

async function save() {
  if (!name.value.trim() || busy.value) return
  busy.value = true
  error.value = null
  try {
    const saved = await api.updateProfile({ name: name.value.trim(), bio: bio.value.trim(), place: place.value.trim() })
    emit('saved', saved)
    open.value = false
    toast.add({ title: 'Profile saved', icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    error.value = err?.message || 'Could not save. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Edit your profile" description="Your handle stays the same. Everything else you can change.">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField label="Name" required><UInput v-model="name" class="w-full" maxlength="50" /></UFormField>
        <UFormField label="Bio" :help="`${160 - bio.length} characters left`"><UTextarea v-model="bio" class="w-full" :rows="3" maxlength="160" placeholder="What you build, in a line." /></UFormField>
        <UFormField label="Where you are"><UInput v-model="place" class="w-full" maxlength="40" placeholder="Accra, Ghana" /></UFormField>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
        <button type="submit" class="hidden" aria-hidden="true" tabindex="-1" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton label="Save" color="neutral" :loading="busy" :disabled="!name.trim()" @click="save" />
      </div>
    </template>
  </UModal>
</template>
