<script setup lang="ts">
import { computed, ref } from 'vue'
import { getToolName } from 'ai'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { $fetch } from 'ofetch'
import { useCsrf } from '../../../composables/useCsrf'

// The assistant saving to a workspace's notes: "Saved to notes" with the note, a way to the notes, and Undo.
const props = defineProps<{ part: any }>()
const { csrf, headerName } = useCsrf()

const streaming = computed(() => isToolStreaming(props.part))
const summary = computed(() => getToolName(props.part) === 'update_where_we_are')
const out = computed(() => (props.part.output && typeof props.part.output === 'object' ? props.part.output as Record<string, any> : null))
const undone = ref(false)
const undoing = ref(false)
const undoFailed = ref(false)

const text = computed(() => {
  if (streaming.value) return summary.value ? 'Updating where we are...' : 'Saving to notes...'
  if (undone.value) return 'Removed from notes'
  switch (out.value?.status) {
    case 'saved': return 'Saved to notes'
    case 'exists': return 'Already in notes'
    case 'updated': return 'Updated where we are'
    default: return summary.value ? 'Could not update where we are' : 'Could not save to notes'
  }
})
const note = computed(() => String(out.value?.text || props.part.input?.text || ''))
const suffix = computed(() => (out.value?.status === 'failed' ? String(out.value?.error || '') : note.value.slice(0, 80) + (note.value.length > 80 ? '…' : '')) || undefined)
const workspaceId = computed(() => String(out.value?.workspaceId || ''))
const canUndo = computed(() => out.value?.status === 'saved' && out.value?.noteId && workspaceId.value && !undone.value)

async function undo() {
  if (undoing.value) return
  undoing.value = true
  undoFailed.value = false
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/notes/${out.value!.noteId}`, { method: 'DELETE', headers: { [headerName]: csrf() } })
    undone.value = true
  } catch { undoFailed.value = true } finally { undoing.value = false }
}
</script>

<template>
  <UChatTool :text="text" :suffix="suffix" :streaming="streaming" icon="i-lucide-notebook-pen" chevron="leading">
    <div class="space-y-2 text-xs text-muted">
      <p v-if="note && out?.status !== 'failed'" class="whitespace-pre-line text-sm leading-relaxed" :class="undone ? 'text-dimmed line-through' : 'text-default'">{{ note }}</p>
      <p class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RouterLink v-if="workspaceId" :to="`/workspaces/${workspaceId}?tab=notes`" class="underline underline-offset-2 hover:text-highlighted">Open notes</RouterLink>
        <button v-if="canUndo" type="button" class="underline underline-offset-2 hover:text-highlighted disabled:opacity-60" :disabled="undoing" @click="undo">Undo</button>
        <span v-if="undoFailed" class="text-error" role="status">Could not undo. Delete it from the notes.</span>
      </p>
    </div>
  </UChatTool>
</template>
