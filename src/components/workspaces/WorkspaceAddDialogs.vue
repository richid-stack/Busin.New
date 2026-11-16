<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { $fetch } from 'ofetch'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { useCsrf } from '../../composables/useCsrf'

/** The three ways to add context that need a window: typed text, a GitHub repository, and a project from The Reef. */
const props = defineProps<{ workspaceId: string, usedChars: number, limitChars: number }>()
const kind = defineModel<'text' | 'github' | 'reef' | null>('kind', { default: null })
const emit = defineEmits<{ added: [] }>()

const { addText, addReef, messageOf } = useWorkspaces()
const { csrf, headerName } = useCsrf()
const toast = useToast()

const busy = ref(false)
const error = ref<string | null>(null)
const close = () => { kind.value = null }
const open = computed({ get: () => kind.value !== null, set: (v) => { if (!v) kind.value = null } })
watch(kind, () => { error.value = null; busy.value = false })

async function run(job: () => Promise<unknown>, done: string) {
  busy.value = true
  error.value = null
  try {
    await job()
    toast.add({ title: done, icon: 'i-lucide-check', color: 'success' })
    emit('added')
    close()
  } catch (err: any) {
    error.value = messageOf(err, 'Could not add that. Try again.')
  } finally {
    busy.value = false
  }
}

// ---- Text
const textName = ref('')
const text = ref('')
watch(kind, (k) => { if (k === 'text') { textName.value = ''; text.value = '' } })
const saveText = () => run(() => addText(props.workspaceId, textName.value, text.value), 'Added to this workspace')

// ---- GitHub
interface Entry { name: string, dir: boolean, bytes: number, files: number }
const repo = ref('')
const entries = ref<Entry[] | null>(null)
const repoName = ref('')
const picked = ref<string[]>([])
const looking = ref(false)
watch(kind, (k) => { if (k === 'github') { repo.value = ''; entries.value = null; picked.value = [] } })

async function look() {
  if (!repo.value.trim() || looking.value) return
  looking.value = true
  error.value = null
  entries.value = null
  picked.value = []
  try {
    const res = await $fetch<{ repo: string, entries: Entry[] }>('/api/workspaces/github', { headers: { [headerName]: csrf() }, query: { repo: repo.value.trim() } })
    entries.value = res.entries
    repoName.value = res.repo
  } catch (err: any) {
    error.value = messageOf(err, 'Could not read that repository.')
  } finally {
    looking.value = false
  }
}
const percent = (bytes: number) => bytes < props.limitChars * 0.01 ? '<1%' : `${Math.round(bytes / props.limitChars * 100)}%`
const pickedBytes = computed(() => (entries.value ?? []).filter(e => picked.value.includes(e.name)).reduce((n, e) => n + e.bytes, 0))
const spacePercent = computed(() => Math.min(100, Math.round((props.usedChars + pickedBytes.value) / props.limitChars * 100)))
const pickedLabel = computed(() => {
  const dirs = (entries.value ?? []).filter(e => picked.value.includes(e.name) && e.dir).length
  const files = picked.value.length - dirs
  return [dirs ? `${dirs} folder${dirs === 1 ? '' : 's'}` : '', files ? `${files} file${files === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') || 'Nothing picked'
})
const toggle = (name: string, on: boolean | 'indeterminate') => {
  picked.value = on === true ? [...new Set([...picked.value, name])] : picked.value.filter(n => n !== name)
}
const saveGithubPicked = () => run(() => $fetch(`/api/workspaces/${props.workspaceId}/github`, { method: 'POST', headers: { [headerName]: csrf() }, body: { repo: repoName.value, paths: picked.value } }), 'Added to this workspace')

// ---- The Reef
interface Card { owner: string, name: string, description: string, kind: string }
const query = ref('')
const results = ref<Card[]>([])
const chosen = ref<Card | null>(null)
const searching = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function search() {
  searching.value = true
  try {
    const res = await $fetch<{ items: Card[] }>('/api/reef/projects', { query: { sort: 'stars', q: query.value.trim() || undefined } })
    results.value = (res.items ?? []).filter(c => c.kind === 'agent').slice(0, 8)
  } catch { results.value = [] } finally { searching.value = false }
}
watch(kind, (k) => { if (k === 'reef') { query.value = ''; chosen.value = null; search() } })
watch(query, () => { clearTimeout(timer); timer = setTimeout(search, 250) })
const saveReef = () => run(() => addReef(props.workspaceId, chosen.value!.owner, chosen.value!.name), 'Added. Its agent now leads this workspace.')
</script>

<template>
  <UModal v-if="kind === 'text'" v-model:open="open" title="Add text content" description="Paste notes, a brief or anything the assistant should know.">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Name">
          <UInput v-model="textName" size="lg" placeholder="Payment terms" class="w-full" :ui="{ root: 'w-full' }" autofocus />
        </UFormField>
        <UFormField label="Text">
          <UTextarea v-model="text" :rows="8" placeholder="Paste or type here" class="w-full" :ui="{ root: 'w-full' }" />
        </UFormField>
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
      </div>
    </template>
    <template #footer>
      <UButton label="Add" :loading="busy" :disabled="!textName.trim() || !text.trim()" @click="saveText" />
      <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
    </template>
  </UModal>

  <UModal v-if="kind === 'github'" v-model:open="open" title="Add from GitHub" description="Pick what to add. It is read once and stored here." :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="overflow-hidden rounded-xl border border-default">
        <form class="flex items-center gap-2 border-b border-default p-2.5" @submit.prevent="look">
          <UIcon name="i-lucide-github" class="ml-1 size-5 shrink-0" />
          <UInput v-model="repo" icon="i-lucide-link" size="sm" placeholder="github.com/owner/name" class="flex-1" :ui="{ root: 'flex-1' }" autofocus />
          <UButton type="submit" label="Look" size="sm" color="neutral" variant="subtle" :loading="looking" :disabled="!repo.trim()" />
        </form>
        <div class="border-b border-default bg-elevated/40 px-3 py-2 text-xs text-muted">Public repositories only for now.</div>
        <div v-if="entries" class="max-h-64 divide-y divide-default overflow-y-auto">
          <label v-for="e in entries" :key="e.name" class="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-elevated/50">
            <UCheckbox :model-value="picked.includes(e.name)" @update:model-value="toggle(e.name, $event)" />
            <UIcon :name="e.dir ? 'i-lucide-folder' : 'i-lucide-file-text'" class="size-4" :class="e.dir ? 'text-primary' : 'text-muted'" />
            <span class="truncate text-default">{{ e.name }}</span>
            <span class="ml-auto text-xs text-muted">{{ percent(e.bytes) }}</span>
          </label>
          <p v-if="!entries.length" class="px-3 py-6 text-center text-sm text-muted">Nothing readable in this repository.</p>
        </div>
        <div v-if="entries" class="flex items-center gap-3 border-t border-default px-3 py-2.5 text-xs text-muted">
          <span>{{ pickedLabel }}</span>
          <UProgress :model-value="spacePercent" size="xs" class="flex-1" :color="spacePercent >= 100 ? 'error' : 'primary'" />
          <span>{{ spacePercent }}% of space used</span>
        </div>
      </div>
      <p v-if="error" class="mt-3 text-sm text-error" role="alert">{{ error }}</p>
    </template>
    <template #footer>
      <UButton :label="picked.length ? `Add ${pickedLabel}` : 'Add'" :loading="busy" :disabled="!entries || !picked.length" @click="saveGithubPicked" />
      <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
    </template>
  </UModal>

  <UModal v-if="kind === 'reef'" v-model:open="open" title="Add from The Reef" description="Its README becomes a file and its agent comes with it." :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <UInput v-model="query" icon="i-lucide-search" size="lg" placeholder="Search The Reef" class="w-full" :ui="{ root: 'w-full' }" autofocus />
      <div class="mt-3 space-y-2">
        <button
          v-for="r in results"
          :key="`${r.owner}/${r.name}`"
          type="button"
          class="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors"
          :class="chosen?.owner === r.owner && chosen?.name === r.name ? 'border-primary/60 bg-primary/5' : 'border-default bg-elevated/50 hover:bg-elevated'"
          @click="chosen = r"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated ring ring-default">
            <UIcon name="i-lucide-bot" class="size-5 text-muted" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-highlighted">{{ r.owner }}/{{ r.name }}</div>
            <div class="truncate text-xs text-muted">{{ r.description }}</div>
          </div>
          <UIcon v-if="chosen?.owner === r.owner && chosen?.name === r.name" name="i-lucide-check" class="ml-auto size-5 shrink-0 text-primary" />
        </button>
        <p v-if="!results.length && !searching" class="py-6 text-center text-sm text-muted">No projects found.</p>
      </div>
      <p v-if="error" class="mt-3 text-sm text-error" role="alert">{{ error }}</p>
    </template>
    <template #footer>
      <UButton label="Add project" :loading="busy" :disabled="!chosen" @click="saveReef" />
      <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
    </template>
  </UModal>
</template>
