<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Workspace } from '../../types/workspaces'
import { useWorkspaces } from '../../composables/useWorkspaces'

/** The window for making a workspace, and (with `workspace` set) for changing its name and rules. */
const props = defineProps<{ workspace?: Workspace | null }>()
const open = defineModel<boolean>('open', { default: false })
/** `add` is the kind of context the person chose in the new-workspace window; the page opens that window next. */
const emit = defineEmits<{ done: [workspace: Workspace, add: 'upload' | 'text' | 'github' | 'reef' | null] }>()

const { createWorkspace, updateWorkspace, messageOf } = useWorkspaces()
const editing = computed(() => Boolean(props.workspace))
const name = ref('')
const rules = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  name.value = props.workspace?.name ?? ''
  rules.value = props.workspace?.instructions ?? ''
  error.value = null
})

async function save(add: 'upload' | 'text' | 'github' | 'reef' | null = null) {
  if (!name.value.trim() || busy.value) return
  busy.value = true
  error.value = null
  try {
    const saved = editing.value
      ? await updateWorkspace(props.workspace!.id, { name: name.value, instructions: rules.value })
      : await createWorkspace({ name: name.value, instructions: rules.value })
    open.value = false
    emit('done', saved, add)
  } catch (err: any) {
    error.value = messageOf(err, 'Could not save the workspace. Try again.')
  } finally {
    busy.value = false
  }
}

// Context needs a workspace to live in, so choosing one creates the workspace first and then opens that window on it.
const contextItems = computed<DropdownMenuItem[][]>(() => [[
  { label: 'Upload from device', icon: 'i-lucide-paperclip', onSelect: () => save('upload') },
  { label: 'Add text content', icon: 'i-lucide-text-cursor-input', onSelect: () => save('text') }
], [
  { label: 'GitHub', icon: 'i-lucide-github', onSelect: () => save('github') },
  { label: 'The Reef', icon: 'i-lucide-waves', onSelect: () => save('reef') }
]])
</script>

<template>
  <UModal
    v-model:open="open"
    :title="editing ? 'Edit workspace' : 'New workspace'"
    :description="editing ? 'Change its name or the rules every chat follows.' : 'One place for a client or a job.'"
    :ui="{ footer: 'flex-row-reverse justify-start' }"
    :close="true"
  >
    <template #body>
      <form class="space-y-5" @submit.prevent="save()">
        <UFormField label="What is it for?">
          <UInput v-model="name" autofocus size="lg" placeholder="Name the workspace" class="w-full" :ui="{ root: 'w-full' }" maxlength="60" />
        </UFormField>
        <UFormField label="Rules for every chat" description="Optional. Tone, names, anything it should always know.">
          <UTextarea v-model="rules" :rows="4" maxlength="2000" placeholder="Describe the client or job, how you want replies written, what to avoid..." class="w-full" :ui="{ root: 'w-full' }" />
        </UFormField>
        <div v-if="!editing">
          <div class="mb-2 flex items-baseline gap-2 text-sm font-medium text-highlighted">Context <span class="text-xs font-normal text-muted">optional</span></div>
          <UDropdownMenu :items="contextItems" :content="{ align: 'start', side: 'bottom' }" :ui="{ content: 'w-56' }">
            <UButton label="Add context" icon="i-lucide-plus" color="neutral" variant="subtle" :disabled="!name.trim() || busy" />
          </UDropdownMenu>
        </div>
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
      </form>
    </template>
    <template #footer>
      <UButton :label="editing ? 'Save' : 'Create workspace'" :loading="busy" :disabled="!name.trim()" @click="save()" />
      <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
    </template>
  </UModal>
</template>
