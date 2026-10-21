<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAgents } from '../../composables/useAgents'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useUserSession } from '../../composables/useUserSession'
import AgentEditor from '../../components/agents/AgentEditor.vue'
import { MODELS } from '../../../shared/utils/models'
import type { AgentInput, AgentProfile } from '../../types/agents'

const ModalConfirm = defineAsyncComponent(() => import('../../components/ModalConfirm.vue'))

const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { agents, options, loading, loaded, unauthorized, loadError, fetchAgents, fetchOptions, createAgent, updateAgent, removeAgent } = useAgents()

onMounted(() => { fetchAgents(); fetchOptions() })
watch(loggedIn, () => { fetchAgents(); fetchOptions() })

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

const editorOpen = ref(false)
const editing = ref<AgentProfile | null>(null)
const saving = ref(false)
const saveError = ref<string | null>(null)

const atLimit = computed(() => options.value ? agents.value.length >= options.value.limits.maxAgents : false)

function openNew() {
  if (unauthorized.value) return openAuthModal()
  editing.value = null
  saveError.value = null
  editorOpen.value = true
}
function openEdit(agent: AgentProfile) {
  editing.value = agent
  saveError.value = null
  editorOpen.value = true
}

async function save(input: AgentInput) {
  saving.value = true
  saveError.value = null
  try {
    if (editing.value) await updateAgent(editing.value.id, input)
    else await createAgent(input)
    editorOpen.value = false
    toast.add({ title: editing.value ? 'Agent saved' : 'Agent created', icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    saveError.value = errorMessage(err, 'Could not save the agent. Try again.')
  } finally {
    saving.value = false
  }
}

const deleteModal = overlay.create(ModalConfirm)
async function remove(agent: AgentProfile) {
  const confirmed = await deleteModal.open({
    title: `Delete "${agent.name}"?`,
    description: 'Chats you had with it stay, but they carry on as the normal assistant. This cannot be undone.',
    color: 'error'
  }).result
  if (!confirmed) return
  try {
    await removeAgent(agent.id)
    toast.add({ title: 'Agent deleted', icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not delete the agent', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const startChat = (agent: AgentProfile) => router.push({ path: '/', query: { agent: agent.id } })
const modelLabel = (id: string | null) => (id ? MODELS.find(m => m.value === id)?.label ?? id : 'Your chat model')
const groupLabel = (id: string) => options.value?.toolGroups.find(g => g.id === id)?.label ?? id

function menuItems(agent: AgentProfile) {
  return [[
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(agent) }
  ], [
    { label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => remove(agent) }
  ]]
}

const isEmpty = computed(() => loaded.value && !loading.value && !unauthorized.value && !loadError.value && agents.value.length === 0)
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="flex items-start justify-between gap-4 mb-10">
        <div>
          <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Agents</h1>
          <p class="text-muted text-base md:text-lg">Saved assistants with their own instructions, tools and skills.</p>
        </div>
        <UButton
          v-if="!unauthorized"
          label="New agent"
          icon="i-lucide-plus"
          color="neutral"
          class="shrink-0"
          :disabled="atLimit"
          @click="openNew"
        />
      </div>

      <div v-if="unauthorized" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to make agents</h2>
        <p class="text-sm text-muted mb-5">Agents are saved to your account and can use the apps you connect.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <div v-else-if="loadError" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-cloud-off" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Could not load your agents</h2>
        <p class="text-sm text-muted mb-5">{{ loadError }}</p>
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchAgents" />
      </div>

      <div v-else-if="!loaded" class="py-12 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="isEmpty" class="rounded-2xl border border-dashed border-default p-10 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-bot" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">No agents yet</h2>
        <p class="text-sm text-muted mb-5">Make one for a job you repeat, like research, your inbox or drafting documents. It starts from a ready-made set you can change.</p>
        <UButton label="New agent" icon="i-lucide-plus" color="neutral" @click="openNew" />
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="group relative rounded-2xl border border-default bg-default p-5 hover:bg-elevated/60 hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col"
        >
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="p-2.5 rounded-xl border border-default shadow-sm bg-default">
              <UIcon name="i-lucide-bot" class="size-5 text-primary" />
            </div>
            <UDropdownMenu :items="menuItems(agent)" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" :aria-label="`Actions for ${agent.name}`" />
            </UDropdownMenu>
          </div>
          <h3 class="text-sm font-semibold text-highlighted mb-1 truncate">{{ agent.name }}</h3>
          <p class="text-xs text-muted leading-relaxed line-clamp-2 min-h-[2rem]">{{ agent.description || agent.instructions }}</p>
          <div class="flex flex-wrap gap-1.5 mt-4">
            <UBadge v-for="id in agent.tools.slice(0, 3)" :key="id" :label="groupLabel(id)" color="neutral" variant="subtle" size="sm" class="max-w-full truncate" />
            <UBadge v-if="agent.tools.length > 3" :label="`+${agent.tools.length - 3}`" color="neutral" variant="subtle" size="sm" />
            <UBadge v-if="!agent.tools.length" label="No tools" color="neutral" variant="subtle" size="sm" />
          </div>
          <p class="text-[11px] text-dimmed mt-3">{{ modelLabel(agent.model) }} · up to {{ agent.maxSteps }} steps</p>
          <div class="flex items-center gap-2 mt-4 pt-4 border-t border-default">
            <UButton label="Chat" icon="i-lucide-message-circle" size="sm" color="neutral" @click="startChat(agent)" />
            <UButton label="Edit" icon="i-lucide-pencil" size="sm" color="neutral" variant="subtle" @click="openEdit(agent)" />
          </div>
        </div>
      </div>

      <p v-if="atLimit" class="text-xs text-muted mt-4">You have reached the limit of {{ options?.limits.maxAgents }} agents. Delete one to make another.</p>
    </div>

    <AgentEditor
      v-model:open="editorOpen"
      :agent="editing"
      :options="options"
      :saving="saving"
      :error="saveError"
      @save="save"
    />
  </div>
</template>
