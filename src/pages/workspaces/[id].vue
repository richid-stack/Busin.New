<script setup lang="ts">
import StateCard from '../../components/state/StateCard.vue'
import PageSkeleton from '../../components/state/PageSkeleton.vue'
import WorkspaceArt from '../../components/workspaces/WorkspaceArt.vue'
import WorkspaceForm from '../../components/workspaces/WorkspaceForm.vue'
import WorkspaceAddDialogs from '../../components/workspaces/WorkspaceAddDialogs.vue'
import PromptAttachments from '../../components/PromptAttachments.vue'
import DictateButton from '../../components/lobby/DictateButton.vue'
import PromptVoiceButton from '../../components/lobby/PromptVoiceButton.vue'
import { ATTACH_ACCEPT } from '../../utils/attachmentTypes'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { $fetch } from 'ofetch'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { useAgents } from '../../composables/useAgents'
import { useChats } from '../../composables/useChats'
import { useChatActions } from '../../composables/useChatActions'
import { useCsrf } from '../../composables/useCsrf'
import { useUserSession } from '../../composables/useUserSession'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { usePromptAttachments } from '../../composables/usePromptAttachments'
import { useDictation } from '../../composables/useDictation'
import { whenUsed, workspaceIcon, sizeLabel, WORKSPACE_ICONS } from '../../utils/workspaceIcons'
import type { Workspace, WorkspaceFile } from '../../types/workspaces'
import { fileToDataUrl } from '../../utils/files'

const ModalConfirm = defineAsyncComponent(() => import('../../components/ModalConfirm.vue'))

const route = useRoute()
const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const { csrf, headerName } = useCsrf()
const { loggedIn } = useUserSession()
const { openAuthModal } = useFirebaseAuth()
const { fetchWorkspaces, updateWorkspace, removeWorkspace, detail, addUpload, removeFile, messageOf, loaded: listLoaded } = useWorkspaces()
const { agents, loaded: agentsLoaded, fetchAgents } = useAgents()
const { chats, fetchChats } = useChats()
const { menuFor } = useChatActions()
const { attachments, processing, onInputChange, remove, clear, toApiAttachments } = usePromptAttachments()

const id = computed(() => String(route.params.id))
const workspace = ref<Workspace | null>(null)
const files = ref<WorkspaceFile[]>([])
const usedChars = ref(0)
const limitChars = ref(600_000)
const maxFiles = ref(6)
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const errorText = ref('')

async function load() {
  if (!loggedIn.value) return
  state.value = 'loading'
  try {
    const res = await detail(id.value)
    workspace.value = res.workspace
    files.value = res.files
    usedChars.value = res.usedChars
    limitChars.value = res.limitChars
    maxFiles.value = res.maxFiles
    state.value = 'ready'
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status
    errorText.value = messageOf(err, 'Could not load this workspace.')
    state.value = status === 404 ? 'missing' : 'error'
  }
}

onMounted(() => {
  if (loggedIn.value) { load(); fetchChats(); if (!agentsLoaded.value) fetchAgents(); if (!listLoaded.value) fetchWorkspaces() }
  else state.value = 'ready'
})
watch(loggedIn, (v) => { if (v) { load(); fetchChats(); fetchAgents(); fetchWorkspaces() } })
watch(id, load)

const agent = computed(() => agents.value.find(a => a.id === workspace.value?.agentId))
const rows = computed(() => chats.value.filter(c => c.workspaceId === id.value).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))

// ---- Composer
const input = ref('')
const loading = ref(false)
const dictation = useDictation(input)
const fileInput = ref<HTMLInputElement | null>(null)

async function startChat(extra: Record<string, unknown> = {}, query?: Record<string, string>) {
  const chat = await $fetch<{ id: string }>('/api/chats', {
    method: 'POST',
    headers: { [headerName]: csrf() },
    body: { workspaceId: id.value, ...extra }
  })
  fetchChats()
  if (chat?.id) router.push({ path: `/chat/${chat.id}`, query })
}
async function onSubmit() {
  const text = input.value.trim()
  if ((!text && !attachments.value.length) || loading.value || processing.value) return
  loading.value = true
  try {
    await startChat({ input: text, attachments: attachments.value.length ? await toApiAttachments() : undefined })
    clear()
  } catch (err: any) {
    toast.add({ title: 'Could not start the chat', description: messageOf(err, 'Please try again in a moment.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    loading.value = false
  }
}
const lobbyLoading = ref(false)
async function talkToLobby() {
  if (lobbyLoading.value) return
  lobbyLoading.value = true
  try { await startChat({}, { lobby: '1' }) } catch (err: any) {
    toast.add({ title: 'Could not start Lobby', description: messageOf(err, 'Please try again in a moment.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally { lobbyLoading.value = false }
}
const plusItems = computed<DropdownMenuItem[][]>(() => [[
  { label: 'Upload files', icon: 'i-lucide-paperclip', onSelect: () => fileInput.value?.click() },
  { label: 'Search the web', icon: 'i-lucide-globe', onSelect: () => { input.value = 'Search the web for: ' } }
]])

// ---- Rail
const formOpen = ref(false)
const addKind = ref<'text' | 'github' | 'reef' | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function chooseAdd(kind: 'upload' | 'text' | 'github' | 'reef') {
  if (kind === 'upload') uploadInput.value?.click()
  else addKind.value = kind
}
// The new-workspace window can ask for a kind of context to be added right after the workspace is made.
watch([state, () => route.query.add], () => {
  const wanted = route.query.add
  if (state.value !== 'ready' || typeof wanted !== 'string') return
  router.replace({ path: route.path })
  if (['upload', 'text', 'github', 'reef'].includes(wanted)) chooseAdd(wanted as 'upload' | 'text' | 'github' | 'reef')
}, { immediate: true })

const addItems = computed<DropdownMenuItem[][]>(() => [[
  { label: 'Upload from device', icon: 'i-lucide-paperclip', onSelect: () => chooseAdd('upload') },
  { label: 'Add text content', icon: 'i-lucide-text-cursor-input', onSelect: () => chooseAdd('text') }
], [
  { label: 'GitHub', icon: 'i-lucide-github', onSelect: () => chooseAdd('github') },
  { label: 'The Reef', icon: 'i-lucide-waves', onSelect: () => chooseAdd('reef') }
]])

async function onUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''
  if (!picked.length) return
  uploading.value = true
  try {
    for (const file of picked) {
      try {
        await addUpload(id.value, file.name, await fileToDataUrl(file))
      } catch (err: any) {
        toast.add({ title: `Could not add ${file.name}`, description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
      }
    }
  } finally {
    uploading.value = false
    await load()
  }
}

async function dropFile(f: WorkspaceFile) {
  try { await removeFile(id.value, f.id); await load() } catch (err: any) {
    toast.add({ title: 'Could not remove the file', description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

async function patch(p: Parameters<typeof updateWorkspace>[1]) {
  try { workspace.value = await updateWorkspace(id.value, p) } catch (err: any) {
    toast.add({ title: 'Could not save that', description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
    await load()
  }
}
const memoryOn = computed({ get: () => workspace.value?.useMemory ?? true, set: v => { patch({ useMemory: v }) } })

const agentItems = computed<DropdownMenuItem[][]>(() => [[
  { label: 'Standard assistant', icon: 'i-lucide-message-circle', type: 'checkbox' as const, checked: !workspace.value?.agentId, onUpdateChecked: () => patch({ agentId: null }) },
  ...agents.value.map(a => ({ label: a.name, icon: 'i-lucide-bot', type: 'checkbox' as const, checked: workspace.value?.agentId === a.id, onUpdateChecked: () => patch({ agentId: a.id }) }))
]])

const iconItems = computed<DropdownMenuItem[][]>(() => [Object.entries(WORKSPACE_ICONS).map(([name, icon]) => ({
  label: name.replace('-2', '').replace('-', ' '), icon, type: 'checkbox' as const, checked: workspace.value?.icon === name, onUpdateChecked: () => patch({ icon: name as Workspace['icon'] })
}))])

const deleteModal = overlay.create(ModalConfirm)
async function destroy() {
  if (!workspace.value) return
  const confirmed = await deleteModal.open({
    title: `Delete "${workspace.value.name}"?`,
    description: 'Its rules and files are deleted. Its chats stay, and carry on without the workspace. This cannot be undone.',
    color: 'error'
  }).result
  if (!confirmed) return
  try { await removeWorkspace(id.value); router.push('/workspaces') } catch (err: any) {
    toast.add({ title: 'Could not delete the workspace', description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}
const titleItems = computed<DropdownMenuItem[][]>(() => [[
  { label: 'Edit name and rules', icon: 'i-lucide-pencil', onSelect: () => { formOpen.value = true } }
], [
  { label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: destroy }
]])

const fileIcon = (f: WorkspaceFile) => f.source === 'github' ? 'i-lucide-github' : f.source === 'reef' ? 'i-lucide-waves' : /\.(pdf|docx?)$/i.test(f.name) ? 'i-lucide-file-text' : 'i-lucide-file'
const isEmpty = computed(() => !rows.value.length && !files.value.length && !workspace.value?.instructions)
</script>

<template>
  <UDashboardPanel id="workspace" class="min-h-0 flex-1 h-full" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar :ui="{ left: 'min-w-0' }" class="sm:px-4">
        <template #left>
          <nav class="flex min-w-0 items-center gap-2 text-sm" aria-label="Breadcrumb">
            <RouterLink to="/workspaces" class="text-muted hover:text-default">Workspaces</RouterLink>
            <template v-if="workspace">
              <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed" />
              <UDropdownMenu :items="titleItems" :content="{ align: 'start' }">
                <UButton color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down" :label="workspace.name" class="min-w-0 max-w-64 font-medium text-highlighted" />
              </UDropdownMenu>
            </template>
          </nav>
        </template>
        <template #right>
          <UButton v-if="workspace" icon="i-lucide-pin" :color="workspace.pinned ? 'primary' : 'neutral'" variant="ghost" :aria-label="workspace.pinned ? 'Unpin' : 'Pin'" @click="patch({ pinned: !workspace.pinned })" />
          <UColorModeButton />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="!loggedIn" class="mx-auto w-full max-w-md px-6 py-16">
        <StateCard icon="i-lucide-lock" title="Sign in to use workspaces" text="Workspaces are saved to your account.">
          <UButton label="Sign in" @click="openAuthModal()" />
        </StateCard>
      </div>
      <div v-else-if="state === 'loading'" class="mx-auto w-full max-w-3xl px-6 py-10"><PageSkeleton /></div>
      <div v-else-if="state === 'missing' || state === 'error'" class="mx-auto w-full max-w-md px-6 py-16">
        <StateCard :icon="state === 'missing' ? 'i-lucide-folder-search' : 'i-lucide-alert-circle'" :tone="state === 'error' ? 'error' : 'neutral'" :title="state === 'missing' ? 'Workspace not found' : 'Could not load this workspace'" :text="errorText">
          <UButton v-if="state === 'error'" label="Try again" color="neutral" @click="load" />
          <UButton label="All workspaces" color="neutral" variant="ghost" to="/workspaces" />
        </StateCard>
      </div>

      <div v-else-if="workspace" class="mx-auto grid w-full max-w-5xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="min-w-0">
          <div class="flex items-center gap-3">
            <UDropdownMenu :items="iconItems" :content="{ align: 'start' }">
              <button type="button" class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-elevated ring ring-default transition-colors hover:bg-accented/50" aria-label="Change the picture">
                <UIcon :name="workspaceIcon(workspace.icon)" class="size-5 text-muted" />
              </button>
            </UDropdownMenu>
            <h1 class="min-w-0 truncate text-2xl font-semibold tracking-tight text-highlighted">{{ workspace.name }}</h1>
          </div>

          <UChatPrompt
            v-model="input"
            class="soft-focus mt-6 rounded-2xl border border-default bg-elevated/50 shadow-sm backdrop-blur-md"
            color="primary"
            variant="subtle"
            :ui="{ base: 'px-3 py-2' }"
            :placeholder="`New chat in ${workspace.name}`"
            @submit="onSubmit"
          >
            <template #header>
              <PromptAttachments :attachments="attachments" @remove="remove" />
            </template>
            <template #footer>
              <div class="flex items-center gap-2 pt-1">
                <UDropdownMenu :items="plusItems" :content="{ align: 'start', side: 'bottom' }">
                  <UButton icon="i-lucide-plus" class="rounded-full" variant="soft" color="primary" size="sm" aria-label="Add files" />
                </UDropdownMenu>
                <input ref="fileInput" type="file" multiple class="hidden" :accept="ATTACH_ACCEPT" @change="onInputChange">
                <ModelSelect v-if="!agent?.model" />
              </div>
              <div class="flex items-center gap-1.5">
                <DictateButton
                  v-if="dictation.supported.value && (dictation.listening.value || dictation.working.value || (!input.trim() && attachments.length === 0))"
                  :listening="dictation.listening.value"
                  :working="dictation.working.value"
                  @press="dictation.toggle()"
                />
                <PromptVoiceButton v-if="!input.trim() && attachments.length === 0" :loading="lobbyLoading" @press="talkToLobby" />
                <UChatPromptSubmit v-else :loading="loading" color="primary" size="sm" class="rounded-full" />
              </div>
            </template>
          </UChatPrompt>

          <div v-if="rows.length" class="mt-9">
            <div class="mb-1 px-3 text-xs font-medium text-muted">Recents</div>
            <ul>
              <li v-for="c in rows" :key="c.id" class="group relative">
                <RouterLink
                  :to="c.to"
                  class="flex items-center gap-4 rounded-lg py-3 pl-3 pr-12 transition-colors hover:bg-elevated/60 focus-visible:bg-elevated/60"
                >
                  <UIcon v-if="c.pinned" name="i-lucide-pin" class="size-3.5 shrink-0 text-dimmed" />
                  <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ c.label }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ whenUsed(c.createdAt) }}</span>
                </RouterLink>
                <UDropdownMenu :items="menuFor(c)" :content="{ align: 'end', side: 'bottom' }" :ui="{ content: 'w-56' }">
                  <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="Chat options"
                    class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  />
                </UDropdownMenu>
              </li>
            </ul>
          </div>
          <div v-else-if="isEmpty" class="mt-8 flex flex-col items-center text-center text-muted">
            <WorkspaceArt class="w-full max-w-xl" />
            <p class="mt-1 max-w-xs text-sm">Nothing here yet. Add the rules and files once, then every chat in this workspace knows them.</p>
          </div>
        </div>

        <aside class="divide-y divide-default text-sm">
          <section class="pb-5">
            <div class="flex items-center justify-between">
              <span class="font-medium text-highlighted">Instructions</span>
              <UButton :label="workspace.instructions ? 'Edit' : 'Add'" color="neutral" variant="ghost" size="xs" @click="formOpen = true" />
            </div>
            <p v-if="workspace.instructions" class="mt-1 leading-relaxed text-muted"><span class="line-clamp-3 whitespace-pre-line">{{ workspace.instructions }}</span></p>
            <p v-else class="mt-1 text-muted">Rules every chat here follows.</p>
          </section>

          <section class="py-5">
            <div class="flex items-center justify-between">
              <span class="font-medium text-highlighted">Files</span>
              <UDropdownMenu :items="addItems" :content="{ align: 'end', side: 'bottom' }" :ui="{ content: 'w-56' }">
                <UButton icon="i-lucide-plus" label="Add" color="neutral" variant="ghost" size="xs" :loading="uploading" :disabled="files.length >= maxFiles" />
              </UDropdownMenu>
              <input ref="uploadInput" type="file" multiple class="hidden" accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/pdf" @change="onUpload">
            </div>
            <ul v-if="files.length" class="mt-1">
              <li v-for="f in files" :key="f.id" class="group flex items-center gap-2.5 py-1.5 text-muted">
                <UIcon :name="fileIcon(f)" class="size-4 shrink-0" />
                <span class="truncate" :title="f.cut ? 'Only the start of this file is kept' : f.name">{{ f.name }}</span>
                <span class="ml-auto shrink-0 text-xs text-dimmed group-hover:hidden group-focus-within:hidden">{{ sizeLabel(f.chars) }}</span>
                <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" class="ml-auto hidden shrink-0 group-hover:inline-flex group-focus-within:inline-flex" :aria-label="`Remove ${f.name}`" @click="dropFile(f)" />
              </li>
            </ul>
            <p v-if="files.length" class="mt-1 text-xs text-dimmed">The assistant opens a file only when a chat needs it.</p>
            <p v-else class="mt-1 text-muted">Add files once and every chat here can use them.</p>
          </section>

          <section class="py-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="font-medium text-highlighted">Memory</div>
                <div class="text-xs text-muted">Use my notes here</div>
              </div>
              <USwitch v-model="memoryOn" aria-label="Use my notes in this workspace" />
            </div>
          </section>

          <section class="pt-5">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="font-medium text-highlighted">Agent</div>
                <div class="truncate text-xs text-muted">{{ agent?.name ?? 'Standard assistant' }}</div>
              </div>
              <UDropdownMenu :items="agentItems" :content="{ align: 'end', side: 'bottom' }" :ui="{ content: 'w-56' }">
                <UButton label="Change" color="neutral" variant="ghost" size="xs" trailing-icon="i-lucide-chevron-down" />
              </UDropdownMenu>
            </div>
          </section>
        </aside>
      </div>

      <!-- Inside the body: a panel given loose children shows only those and drops its header and body. -->
      <WorkspaceForm v-model:open="formOpen" :workspace="workspace" @done="(w) => { workspace = w }" />
      <WorkspaceAddDialogs v-if="workspace" v-model:kind="addKind" :workspace-id="id" :used-chars="usedChars" :limit-chars="limitChars" @added="load" />
    </template>
  </UDashboardPanel>
</template>
