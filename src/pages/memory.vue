<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import { useMemory } from '../composables/useMemory'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { useUserSession } from '../composables/useUserSession'
import type { MemoryItem } from '../types/memory'

const ModalConfirm = defineAsyncComponent(() => import('../components/ModalConfirm.vue'))

const toast = useToast()
const overlay = useOverlay()
const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { items, enabled, limits, loading, loaded, unauthorized, loadError, fetchMemory, addItem, editItem, removeItem, clearAll, setEnabled } = useMemory()

onMounted(fetchMemory)
watch(loggedIn, fetchMemory)

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

const atLimit = computed(() => items.value.length >= limits.value.maxItems)

// ---- Add ----
const draft = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)

async function add() {
  const text = draft.value.trim()
  if (!text || adding.value) return
  adding.value = true
  addError.value = null
  try {
    await addItem(text)
    draft.value = ''
  } catch (err: any) {
    addError.value = errorMessage(err, 'Could not save that. Try again.')
  } finally {
    adding.value = false
  }
}

// ---- Edit ----
const editingId = ref<string | null>(null)
const editText = ref('')
const editError = ref<string | null>(null)
const saving = ref(false)

async function startEdit(item: MemoryItem) {
  editingId.value = item.id
  editText.value = item.text
  editError.value = null
  await nextTick()
  document.getElementById(`memory-edit-${item.id}`)?.focus()
}

async function saveEdit(item: MemoryItem) {
  const text = editText.value.trim()
  if (!text) { editError.value = 'A memory cannot be empty. Delete it instead.'; return }
  if (text === item.text) { editingId.value = null; return }
  saving.value = true
  editError.value = null
  try {
    await editItem(item.id, text)
    editingId.value = null
  } catch (err: any) {
    editError.value = errorMessage(err, 'Could not save that. Try again.')
  } finally {
    saving.value = false
  }
}

// ---- Delete, clear, switch ----
async function remove(item: MemoryItem) {
  try {
    await removeItem(item.id)
  } catch (err: any) {
    toast.add({ title: 'Could not delete that', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const clearModal = overlay.create(ModalConfirm)
async function clear() {
  const confirmed = await clearModal.open({
    title: 'Forget everything?',
    description: `All ${items.value.length} saved items are deleted. This cannot be undone.`,
    confirmLabel: 'Forget everything',
    color: 'error'
  }).result
  if (!confirmed) return
  try {
    await clearAll()
    toast.add({ title: 'Memory cleared', icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not clear memory', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

async function toggle(value: boolean) {
  try {
    await setEnabled(value)
  } catch (err: any) {
    toast.add({ title: 'Could not change that', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const isEmpty = computed(() => loaded.value && !loading.value && !unauthorized.value && !loadError.value && items.value.length === 0)
const showList = computed(() => loaded.value && !unauthorized.value && !loadError.value)

const PILLARS = [
  { icon: 'i-lucide-pencil-line', title: 'You decide what is kept', detail: 'Add, edit or delete anything here. Nothing is saved unless you ask for it.' },
  { icon: 'i-lucide-message-circle', title: 'Just say it in chat', detail: 'Tell OpenLobs to “remember that…” or “forget that…” and it updates this list.' },
  { icon: 'i-lucide-lock-keyhole', title: 'No secrets, no surprises', detail: 'Passwords and keys are refused, and text from web pages or files can never add to it.' }
]
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="mb-10">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Memory</h1>
        <p class="text-muted text-base md:text-lg">Short notes OpenLobs keeps about you, so you do not have to repeat yourself.</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
        <div v-for="pillar in PILLARS" :key="pillar.title" class="rounded-2xl border border-default bg-elevated/40 p-4">
          <div class="size-8 rounded-lg border border-default bg-default shadow-sm flex items-center justify-center mb-3">
            <UIcon :name="pillar.icon" class="size-4 text-primary" />
          </div>
          <h3 class="text-sm font-semibold text-highlighted mb-1">{{ pillar.title }}</h3>
          <p class="text-xs text-muted leading-relaxed">{{ pillar.detail }}</p>
        </div>
      </div>

      <div v-if="unauthorized" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to use memory</h2>
        <p class="text-sm text-muted mb-5">Memory belongs to your account, so only you can see it.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <div v-else-if="loadError" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-cloud-off" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Could not load your memory</h2>
        <p class="text-sm text-muted mb-5">{{ loadError }}</p>
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchMemory" />
      </div>

      <div v-else-if="!loaded" class="py-12 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <template v-if="showList">
        <div class="flex items-center justify-between gap-4 rounded-2xl border border-default bg-default p-4 sm:p-5 mb-6">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-highlighted">Use memory in chats</h2>
            <p class="text-xs text-muted leading-snug">{{ enabled ? 'On. Saved notes are shared with the assistant in every chat.' : 'Off. Nothing is shared and nothing new is saved. Your notes stay here.' }}</p>
          </div>
          <USwitch :model-value="enabled" aria-label="Use memory in chats" @update:model-value="toggle(Boolean($event))" />
        </div>

        <form class="mb-2 flex gap-2" @submit.prevent="add">
          <UInput
            v-model="draft"
            class="flex-1"
            size="lg"
            :maxlength="limits.maxChars"
            :disabled="atLimit"
            :placeholder="atLimit ? 'Memory is full. Delete something to add more.' : 'Add a note about you'"
            aria-label="New memory"
            autocomplete="off"
          />
          <UButton type="submit" label="Add" icon="i-lucide-plus" color="neutral" size="lg" :loading="adding" :disabled="!draft.trim() || atLimit" />
        </form>
        <p v-if="addError" class="text-xs text-error mb-2" role="alert">{{ addError }}</p>
        <p v-else class="text-xs text-dimmed mb-6">Please do not save passwords, keys or card numbers here.</p>

        <div v-if="isEmpty" class="rounded-2xl border border-dashed border-default p-10 text-center">
          <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
            <UIcon name="i-lucide-brain" class="size-5 text-muted" />
          </div>
          <h2 class="text-base font-semibold text-highlighted mb-1">Nothing saved yet</h2>
          <p class="text-sm text-muted">Add a note above, or tell OpenLobs in a chat: “Remember that I work in Accra and prefer British spelling.”</p>
        </div>

        <ul v-else class="flex flex-col gap-2">
          <li v-for="item in items" :key="item.id" class="group rounded-xl border border-default bg-default px-4 py-3 hover:bg-elevated/60 transition-colors">
            <div v-if="editingId === item.id">
              <form class="flex gap-2" @submit.prevent="saveEdit(item)">
                <UInput :id="`memory-edit-${item.id}`" v-model="editText" class="flex-1" :maxlength="limits.maxChars" aria-label="Edit memory" autocomplete="off" @keydown.esc="editingId = null" />
                <UButton type="submit" label="Save" size="sm" color="neutral" :loading="saving" />
                <UButton label="Cancel" size="sm" color="neutral" variant="ghost" @click="editingId = null" />
              </form>
              <p v-if="editError" class="text-xs text-error mt-1.5" role="alert">{{ editError }}</p>
            </div>
            <div v-else class="flex items-start gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-sm text-highlighted leading-snug break-words">{{ item.text }}</p>
                <p class="text-[11px] text-dimmed mt-1">{{ item.source === 'assistant' ? 'Saved from a chat' : 'Added by you' }}</p>
              </div>
              <div class="flex shrink-0 gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" :aria-label="`Edit: ${item.text}`" @click="startEdit(item)" />
                <UButton icon="i-lucide-trash" size="xs" color="error" variant="ghost" :aria-label="`Delete: ${item.text}`" @click="remove(item)" />
              </div>
            </div>
          </li>
        </ul>

        <div v-if="items.length" class="flex items-center justify-between mt-4">
          <p class="text-xs text-muted">{{ items.length }} of {{ limits.maxItems }} notes</p>
          <UButton label="Forget everything" icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" @click="clear" />
        </div>
      </template>
    </div>
  </div>
</template>
