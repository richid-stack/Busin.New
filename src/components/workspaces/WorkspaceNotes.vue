<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { usePreferences } from '../../composables/usePreferences'
import type { WhereWeAre, WorkspaceNote } from '../../types/workspaces'
import Reveal from '../state/Reveal.vue'

// The notes of one workspace: the short "where we are" summary, then one-sentence notes. Plain rows, no cards.
const props = defineProps<{ workspaceId: string, off: '' | 'workspace' | 'settings' }>()
const emit = defineEmits<{ openPowers: [] }>()

const MAX_NOTE = 300
const MAX_WHERE = 1200
const toast = useToast()
const { used } = usePreferences()
const { fetchNotes, addNote, removeNote, saveWhereWeAre, messageOf } = useWorkspaces()

const notes = ref<WorkspaceNote[]>([])
const where = ref<WhereWeAre | null>(null)
const maxNotes = ref(30)
const state = ref<'loading' | 'ready' | 'error'>('loading')

async function load() {
  try {
    const res = await fetchNotes(props.workspaceId)
    notes.value = res.notes
    where.value = res.whereWeAre
    maxNotes.value = res.maxNotes
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}
onMounted(load)
watch(() => props.workspaceId, () => { state.value = 'loading'; void load() })

const fail = (title: string, err: any) => toast.add({ title, description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })

// ---- Where we are
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const draftBox = ref<HTMLTextAreaElement | null>(null)
async function startEdit() {
  draft.value = where.value?.text ?? ''
  editing.value = true
  await nextTick()
  draftBox.value?.focus()
}
async function saveWhere() {
  if (saving.value) return
  saving.value = true
  try {
    where.value = (await saveWhereWeAre(props.workspaceId, draft.value)).whereWeAre
    editing.value = false
  } catch (err) { fail('Could not save that', err) } finally { saving.value = false }
}

// ---- Notes
const text = ref('')
const adding = ref(false)
const full = computed(() => notes.value.length >= maxNotes.value)
async function add() {
  const value = text.value.trim()
  if (!value || adding.value || full.value) return
  adding.value = true
  try {
    const note = await addNote(props.workspaceId, value)
    if (!notes.value.some(n => n.id === note.id)) notes.value = [...notes.value, note]
    text.value = ''
  } catch (err) { fail('Could not add the note', err) } finally { adding.value = false }
}
async function drop(n: WorkspaceNote) {
  const before = notes.value
  notes.value = notes.value.filter(x => x.id !== n.id)
  try { await removeNote(props.workspaceId, n.id) } catch (err) { notes.value = before; fail('Could not delete the note', err) }
}

const offText = computed(() => props.off === 'settings'
  ? 'Notes are off in Settings, so the assistant neither reads nor saves them. You can still write and edit them here.'
  : 'Notes are off for this workspace, so the assistant neither reads nor saves them. You can still write and edit them here.')
</script>

<template>
  <div class="mt-4">
    <p v-if="off" class="mb-3 text-xs leading-relaxed text-muted" role="status">
      {{ offText }}
      <button v-if="off === 'workspace'" type="button" class="underline underline-offset-2 hover:text-highlighted" @click="emit('openPowers')">Turn it on</button>
      <RouterLink v-else to="/settings?s=powers" class="underline underline-offset-2 hover:text-highlighted">Open Settings</RouterLink>
    </p>

    <div v-if="state === 'loading'" class="space-y-3 py-4" aria-busy="true">
      <USkeleton class="h-4 w-24" /><USkeleton class="h-5 w-full" /><USkeleton class="h-5 w-2/3" />
    </div>
    <p v-else-if="state === 'error'" class="py-4 text-sm text-muted">
      Could not load the notes.
      <button type="button" class="underline underline-offset-2 hover:text-highlighted" @click="load">Try again</button>
    </p>

    <template v-else>
      <!-- Where we are -->
      <section class="border-y border-default py-5" aria-labelledby="where-we-are">
        <div class="flex items-center justify-between gap-3">
          <h2 id="where-we-are" class="text-xs font-medium uppercase tracking-wider text-muted">Where we are</h2>
          <UButton v-if="!editing" :label="where ? 'Edit' : 'Write'" color="neutral" variant="ghost" size="xs" @click="startEdit" />
        </div>
        <Reveal>
          <div v-if="editing" class="mt-2">
            <textarea
              ref="draftBox"
              v-model="draft"
              rows="4"
              :maxlength="MAX_WHERE"
              aria-label="Where we are"
              class="soft-focus w-full resize-y rounded-lg border border-default bg-elevated/50 px-3 py-2 text-[15px] leading-7 text-highlighted placeholder:text-dimmed"
              placeholder="What is decided, what is done, what is next."
              @keydown.esc="editing = false"
            />
            <div class="mt-2 flex items-center gap-2">
              <UButton label="Save" size="sm" color="neutral" :loading="saving" @click="saveWhere" />
              <UButton label="Cancel" size="sm" color="neutral" variant="ghost" @click="editing = false" />
              <span class="ml-auto font-mono text-[10px] tracking-wider text-dimmed">{{ draft.length }} / {{ MAX_WHERE }}</span>
            </div>
          </div>
        </Reveal>
        <template v-if="!editing">
          <template v-if="where">
            <p class="mt-2 whitespace-pre-line text-[15px] leading-7 text-highlighted">{{ where.text }}</p>
            <p class="mt-2 font-mono text-[10px] uppercase tracking-wider text-dimmed">Updated by {{ where.by === 'you' ? 'you' : 'the assistant' }} · {{ used(where.at) }}</p>
          </template>
          <p v-else class="mt-2 text-sm leading-relaxed text-muted">Not written yet. The assistant fills this in as you work, or you can write it yourself.</p>
        </template>
      </section>

      <!-- Add a note -->
      <form class="flex items-center gap-3 border-b border-default py-1.5 pl-3" @submit.prevent="add">
        <UIcon name="i-lucide-plus" class="size-4 shrink-0 text-dimmed" />
        <input
          v-model="text"
          type="text"
          :maxlength="MAX_NOTE"
          :disabled="full"
          class="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-highlighted outline-none placeholder:text-dimmed disabled:cursor-not-allowed"
          :placeholder="full ? 'This workspace is full. Delete a note to add another.' : 'Write a note'"
          aria-label="Write a note"
        >
        <UButton v-if="text.trim()" type="submit" label="Add" size="xs" color="neutral" variant="ghost" :loading="adding" />
      </form>

      <ul v-if="notes.length" class="divide-y divide-default">
        <li v-for="n in notes" :key="n.id" class="group flex items-start gap-4 py-3.5 pl-3">
          <p class="min-w-0 flex-1 whitespace-pre-line break-words text-sm leading-relaxed text-highlighted">{{ n.text }}</p>
          <div class="flex shrink-0 items-center gap-2 pt-0.5">
            <span class="rounded bg-accented/50 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted">{{ n.by === 'you' ? 'You' : 'Assistant' }}</span>
            <span class="hidden font-mono text-[10px] uppercase tracking-wider text-dimmed sm:inline">{{ used(n.createdAt) }}</span>
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" aria-label="Delete note" class="sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-visible:opacity-100" @click="drop(n)" />
          </div>
        </li>
      </ul>
      <p v-else class="py-5 pl-3 text-sm leading-relaxed text-muted">Nothing saved yet. When something matters, like a decision, a name or what is next, the assistant saves a short note here, so the next chat starts where this one stopped.</p>

      <p class="mt-4 pl-3 text-xs leading-relaxed text-dimmed">Every chat in this workspace starts by reading these. The assistant keeps them short and saves only what matters.</p>
    </template>
  </div>
</template>
