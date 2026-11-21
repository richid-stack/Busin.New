<script setup lang="ts">
import PageSkeleton from '../../components/state/PageSkeleton.vue'
import StateCard from '../../components/state/StateCard.vue'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAgents } from '../../composables/useAgents'
import { useModelProviders } from '../../composables/useModelProviders'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useUserSession } from '../../composables/useUserSession'
import AgentEditor from '../../components/agents/AgentEditor.vue'
import ProfileSetupDialog from '../../components/reef/ProfileSetupDialog.vue'
import PublishDialog from '../../components/reef/PublishDialog.vue'
import { MODELS } from '../../../shared/utils/models'
import { mascotFor } from '../../../shared/mascots'
import { SPECIALISTS } from '../../../shared/specialists'
import Person from '../../components/agents/Person.vue'
import Creature from '../../components/agents/Creature.vue'
import StatusChip from '../../components/tasks/StatusChip.vue'
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

const shareOpen = ref(false)
const sharing = ref<AgentProfile | null>(null)
const openShare = (agent: AgentProfile) => { sharing.value = agent; shareOpen.value = true }
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
const { myModels, myLoaded, fetchMyModels } = useModelProviders()
onMounted(() => { if (!myLoaded.value) void fetchMyModels() })
const modelLabel = (id: string | null) => (id ? MODELS.find(m => m.value === id)?.label ?? myModels.value.find(m => m.value === id)?.label ?? id.replace(/^my:[^/]*\//, '') : 'Your chat model')
const groupLabel = (id: string) => options.value?.toolGroups.find(g => g.id === id)?.label ?? id

function menuItems(agent: AgentProfile) {
  return [[
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(agent) },
    { label: 'Share…', icon: 'i-lucide-share-2', onSelect: () => openShare(agent) }
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
          <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">
            Agents
          </h1>
          <p class="text-muted text-base md:text-lg">
            Saved assistants with their own instructions, tools and skills.
          </p>
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

      <StateCard
        v-if="unauthorized"
        icon="i-lucide-lock"
        title="Sign in to make agents"
        text="Agents are saved to your account and can use the apps you connect."
      >
        <UButton
          label="Sign in"
          icon="i-lucide-log-in"
          color="neutral"
          @click="openAuthModal"
        />
      </StateCard>

      <StateCard
        v-else-if="loadError"
        icon="i-lucide-cloud-off"
        title="Could not load your agents"
        :text="loadError"
      >
        <UButton
          label="Try again"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="subtle"
          :loading="loading"
          @click="fetchAgents"
        />
      </StateCard>

      <PageSkeleton
        v-else-if="!loaded"
        shape="cards"
      />

      <StateCard
        v-else-if="isEmpty"
        icon="i-lucide-bot"
        title="No agents yet"
        text="Make one for a job you repeat, like research, your inbox or drafting documents. It starts from a ready-made set you can change."
        kind="empty"
      >
        <UButton
          label="New agent"
          icon="i-lucide-plus"
          color="neutral"
          @click="openNew"
        />
      </StateCard>

      <ul
        v-else
        class="divide-y divide-default border-y border-default"
      >
        <li
          v-for="agent in agents"
          :key="agent.id"
          class="flex items-start gap-4 py-5"
        >
          <div class="size-14 shrink-0 rounded-2xl border border-default bg-elevated/60 flex items-center justify-center">
            <Person
              :id="mascotFor(agent)"
              :size="48"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="text-sm font-semibold text-highlighted truncate">
                  {{ agent.name }}
                </h3>
                <p class="mt-0.5 text-xs text-muted leading-relaxed line-clamp-2">
                  {{ agent.description || agent.instructions }}
                </p>
              </div>
              <UDropdownMenu
                :items="menuItems(agent)"
                :content="{ align: 'end' }"
              >
                <UButton
                  icon="i-lucide-ellipsis"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Actions for ${agent.name}`"
                />
              </UDropdownMenu>
            </div>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <StatusChip
                v-for="id in agent.tools.slice(0, 3)"
                :key="id"
                :label="groupLabel(id)"
                tone="quiet"
                class="max-w-full truncate"
              />
              <StatusChip
                v-if="agent.tools.length > 3"
                :label="`+${agent.tools.length - 3}`"
                tone="quiet"
              />
              <StatusChip
                v-if="!agent.tools.length"
                label="No tools"
                tone="quiet"
              />
            </div>
            <p class="mt-2 text-[11px] text-dimmed">
              {{ modelLabel(agent.model) }} · up to {{ agent.maxSteps }} steps
            </p>
            <p
              v-if="agent.source"
              class="mt-1 flex items-center gap-1 min-w-0 text-[11px] text-dimmed"
            >
              <UIcon
                name="i-lucide-waves"
                class="size-3 shrink-0"
              />
              <RouterLink
                v-if="agent.source.project"
                :to="`/reef/${agent.source.project}`"
                class="truncate hover:text-default hover:underline"
              >
                From The Reef · {{ agent.source.project }}
              </RouterLink>
              <span
                v-else
                class="truncate"
              >From The Reef<template v-if="agent.source.author"> · by {{ agent.source.author }}</template></span>
            </p>
            <div class="mt-3 flex items-center gap-2">
              <UButton
                label="Chat"
                icon="i-lucide-message-circle"
                size="sm"
                color="neutral"
                @click="startChat(agent)"
              />
              <UButton
                label="Edit"
                icon="i-lucide-pencil"
                size="sm"
                color="neutral"
                variant="subtle"
                @click="openEdit(agent)"
              />
            </div>
          </div>
        </li>
      </ul>

      <p
        v-if="atLimit"
        class="text-xs text-muted mt-4"
      >
        You have reached the limit of {{ options?.limits.maxAgents }} agents. Delete one to make another.
      </p>

      <section
        class="mt-16"
        aria-labelledby="built-in-heading"
      >
        <div class="flex items-center gap-2.5">
          <h2
            id="built-in-heading"
            class="text-lg font-semibold tracking-tight text-highlighted"
          >
            OpenLobs specialists
          </h2>
          <StatusChip
            label="Built in"
            tone="quiet"
          />
        </div>
        <p class="mt-1.5 mb-5 max-w-xl text-sm text-muted">
          OpenLobs hands a job to one of these on its own when one fits, and says so in the chat. They are not counted in your {{ options?.limits.maxAgents ?? 10 }} agents, and they cannot be changed.
        </p>
        <ul class="divide-y divide-default border-y border-default">
          <li
            v-for="s in SPECIALISTS"
            :key="s.id"
          >
            <details class="group">
              <summary class="flex cursor-pointer list-none items-center gap-4 py-4 focus-visible:outline-2 focus-visible:outline-primary">
                <div class="size-12 shrink-0 rounded-xl border border-default bg-elevated/60 flex items-center justify-center">
                  <Creature
                    :species="s.id"
                    :size="40"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-highlighted">
                    {{ s.name }}
                    <span class="font-mono text-[11px] font-medium uppercase tracking-wider text-muted">{{ s.role }}</span>
                  </p>
                  <p class="mt-0.5 text-xs text-muted">
                    {{ s.note }}
                  </p>
                </div>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 shrink-0 text-dimmed transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <div class="pb-5 pl-16 pr-2">
                <p class="text-sm text-default">
                  {{ s.when }}
                </p>
                <div class="mt-3 flex flex-wrap gap-1.5">
                  <StatusChip
                    v-for="g in s.groups"
                    :key="g"
                    :label="groupLabel(g)"
                    tone="quiet"
                    class="max-w-full truncate"
                  />
                </div>
              </div>
            </details>
          </li>
        </ul>
      </section>
    </div>

    <PublishDialog
      v-model:open="shareOpen"
      :agent="sharing"
    />
    <ProfileSetupDialog />

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
