<script setup lang="ts">
import PageSkeleton from '../../components/state/PageSkeleton.vue'
import StateCard from '../../components/state/StateCard.vue'
import WorkspaceForm from '../../components/workspaces/WorkspaceForm.vue'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useUserSession } from '../../composables/useUserSession'
import { whenUsed, workspaceIcon } from '../../utils/workspaceIcons'
import type { Workspace } from '../../types/workspaces'

const ModalConfirm = defineAsyncComponent(() => import('../../components/ModalConfirm.vue'))

const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { workspaces, max, loaded, loading, loadError, fetchWorkspaces, updateWorkspace, removeWorkspace, messageOf } = useWorkspaces()

onMounted(() => { if (loggedIn.value) fetchWorkspaces() })
watch(loggedIn, (v) => { if (v) fetchWorkspaces() })

const searching = ref(false)
const query = ref('')
const sort = ref<'used' | 'name' | 'new'>('used')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = workspaces.value.filter(w => !q || w.name.toLowerCase().includes(q))
  return [...list].sort((a, b) => sort.value === 'name'
    ? a.name.localeCompare(b.name)
    : sort.value === 'new' ? b.createdAt.localeCompare(a.createdAt) : b.lastUsedAt.localeCompare(a.lastUsedAt))
})
const sortItems = computed(() => [[
  { label: 'Last used', type: 'checkbox' as const, checked: sort.value === 'used', onUpdateChecked: () => { sort.value = 'used' } },
  { label: 'Name', type: 'checkbox' as const, checked: sort.value === 'name', onUpdateChecked: () => { sort.value = 'name' } },
  { label: 'Newest', type: 'checkbox' as const, checked: sort.value === 'new', onUpdateChecked: () => { sort.value = 'new' } }
]])

const formOpen = ref(false)
const atLimit = computed(() => workspaces.value.length >= max.value)
function openNew() {
  if (!loggedIn.value) return openAuthModal()
  formOpen.value = true
}
function created(w: Workspace, add: string | null) {
  router.push({ path: `/workspaces/${w.id}`, query: add ? { add } : {} })
}

async function togglePin(w: Workspace) {
  try { await updateWorkspace(w.id, { pinned: !w.pinned }) } catch (err: any) {
    toast.add({ title: 'Could not change the pin', description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}
const deleteModal = overlay.create(ModalConfirm)
async function remove(w: Workspace) {
  const confirmed = await deleteModal.open({
    title: `Delete "${w.name}"?`,
    description: 'Its rules and files are deleted. Its chats stay, and carry on without the workspace. This cannot be undone.',
    color: 'error'
  }).result
  if (!confirmed) return
  try {
    await removeWorkspace(w.id)
    toast.add({ title: 'Workspace deleted', icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not delete the workspace', description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}
const menu = (w: Workspace) => [[
  { label: w.pinned ? 'Unpin' : 'Pin', icon: 'i-lucide-pin', onSelect: () => togglePin(w) }
], [
  { label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(w) }
]]

const isEmpty = computed(() => loaded.value && !loading.value && !loadError.value && workspaces.value.length === 0)
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div class="flex items-center gap-3">
        <h1 class="text-3xl font-semibold tracking-tight text-highlighted">Workspaces</h1>
        <div v-if="loggedIn" class="ml-auto flex items-center gap-1">
          <UButton icon="i-lucide-search" color="neutral" variant="ghost" aria-label="Search" @click="searching = !searching" />
          <UDropdownMenu :items="sortItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-arrow-up-down" color="neutral" variant="ghost" aria-label="Sort" />
          </UDropdownMenu>
          <UButton label="New workspace" icon="i-lucide-plus" class="ml-1" :disabled="atLimit" @click="openNew" />
        </div>
      </div>
      <p class="mt-3 text-sm text-muted">One place for each client or job: its rules and files, and every chat about it.</p>

      <UInput v-if="searching" v-model="query" icon="i-lucide-search" placeholder="Search workspaces" class="mt-6 w-full" :ui="{ root: 'w-full' }" autofocus />

      <div class="mt-8">
        <StateCard v-if="!loggedIn" icon="i-lucide-lock" title="Sign in to use workspaces" text="Workspaces are saved to your account.">
          <UButton label="Sign in" @click="openAuthModal()" />
        </StateCard>
        <StateCard v-else-if="loadError" icon="i-lucide-alert-circle" tone="error" title="Could not load your workspaces" :text="loadError">
          <UButton label="Try again" color="neutral" @click="fetchWorkspaces()" />
        </StateCard>
        <PageSkeleton v-else-if="!loaded" />
        <StateCard v-else-if="isEmpty" kind="empty" icon="i-lucide-folders" title="No workspaces yet" text="Make one for a client or a job. Its rules and files are known to every chat inside it.">
          <UButton label="New workspace" icon="i-lucide-plus" @click="openNew" />
        </StateCard>
        <div v-else class="grid gap-3">
          <p v-if="!shown.length" class="py-8 text-center text-sm text-muted">Nothing matches that.</p>
          <div
            v-for="w in shown"
            :key="w.id"
            class="group flex items-center gap-4 rounded-2xl border border-default bg-elevated/50 p-4 transition-colors hover:bg-elevated"
          >
            <RouterLink :to="`/workspaces/${w.id}`" class="flex min-w-0 flex-1 items-center gap-4 rounded-xl outline-primary/25 focus-visible:outline-3">
              <div class="flex size-14 shrink-0 items-center justify-center rounded-xl bg-elevated ring ring-default">
                <UIcon :name="workspaceIcon(w.icon)" class="size-6 text-muted" />
              </div>
              <div class="min-w-0">
                <div class="truncate font-medium text-highlighted">{{ w.name }}</div>
                <div class="text-sm text-muted">{{ whenUsed(w.lastUsedAt) }}</div>
              </div>
            </RouterLink>
            <div class="ml-auto flex items-center gap-1">
              <UDropdownMenu :items="menu(w)" :content="{ align: 'end' }">
                <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="More" />
              </UDropdownMenu>
              <UButton
                icon="i-lucide-pin"
                :color="w.pinned ? 'primary' : 'neutral'"
                variant="ghost"
                size="sm"
                :class="w.pinned ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'"
                :aria-label="w.pinned ? 'Unpin' : 'Pin'"
                @click="togglePin(w)"
              />
            </div>
          </div>
          <p v-if="atLimit" class="text-xs text-muted">You can keep up to {{ max }} workspaces. Delete one to add another.</p>
        </div>
      </div>
    </div>
    <WorkspaceForm v-model:open="formOpen" @done="created" />
  </div>
</template>
