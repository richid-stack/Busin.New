<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useReef } from '../../composables/useReef'
import { useReefMe } from '../../composables/useReefMe'
import type { ProjectDetail } from '../../types/reef'

const props = defineProps<{ project: ProjectDetail }>()
const open = defineModel<boolean>('open', { default: false })

const router = useRouter()
const toast = useToast()
const api = useReef()
const { profile, requireProfile } = useReefMe()

const name = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
watch(open, (o) => { if (o) { name.value = props.project.name; error.value = null } })
const ok = computed(() => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name.value))

async function fork() {
  if (!ok.value || busy.value) return
  if (!requireProfile(() => { open.value = true })) { open.value = false; return }
  busy.value = true
  error.value = null
  try {
    const made = await api.fork(props.project.owner, props.project.name, name.value)
    open.value = false
    toast.add({ title: 'Forked to your projects', icon: 'i-lucide-git-fork', color: 'success' })
    await router.push(`/reef/${made.owner}/${made.name}`)
  } catch (err: any) {
    error.value = err?.message || 'Could not fork. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Fork this project" :description="`Make your own copy of ${project.owner}/${project.name} in The Reef. It keeps a link back to the original.`">
    <template #body>
      <form class="space-y-4" @submit.prevent="fork">
        <UFormField label="Name for your copy" required :help="profile ? `Address: /reef/${profile.handle}/${name || 'name'}` : undefined" :error="name && !ok ? 'Use letters, numbers and dashes, up to 40.' : undefined">
          <UInput v-model="name" class="w-full" maxlength="40" autocapitalize="none" spellcheck="false" />
        </UFormField>
        <p class="text-xs text-muted">The licence stays as {{ project.licence.short }}. You can change the description and README after.</p>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-alert-circle" :description="error" />
        <button type="submit" class="hidden" aria-hidden="true" tabindex="-1" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton label="Fork" icon="i-lucide-git-fork" color="neutral" :loading="busy" :disabled="!ok" @click="fork" />
      </div>
    </template>
  </UModal>
</template>
