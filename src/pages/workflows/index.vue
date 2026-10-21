<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { $fetch } from 'ofetch'
import { useCsrf } from '../../composables/useCsrf'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useModels } from '../../composables/useModels'
import WorkflowTemplates from '../../components/workflow/WorkflowTemplates.vue'
import { instantiateTemplate } from '../../utils/workflowTemplates'
import type { WorkflowTemplate } from '../../utils/workflowTemplates'

const ModalConfirm = defineAsyncComponent(() => import('../../components/ModalConfirm.vue'))

interface WorkflowSummary {
  id: string
  title: string
  description?: string
  status: 'active' | 'draft' | 'paused'
  nodes?: unknown[]
  updatedAt?: string
  createdAt?: string
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const { csrf, headerName } = useCsrf()
const { openAuthModal, isAuthenticated } = useFirebaseAuth()
const { defaultModel } = useModels()

// Links from before the studio had its own page: /workflows?id=...
if (typeof route.query.id === 'string' && route.query.id) {
  router.replace(`/workflows/${route.query.id}`)
}

const workflows = ref<WorkflowSummary[]>([])
const loading = ref(true)
const unauthorized = ref(false)
const loadError = ref<string | null>(null)

const errorMessage = (err: any, fallback: string) =>
  err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

async function fetchWorkflows() {
  loading.value = true
  loadError.value = null
  try {
    const headers: Record<string, string> = {}
    const token = csrf()
    if (token) headers[headerName] = token
    workflows.value = await $fetch<WorkflowSummary[]>('/api/workflows', { headers })
    unauthorized.value = false
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status
    if (status === 401 || status === 403) {
      unauthorized.value = true
      workflows.value = []
    } else {
      loadError.value = errorMessage(err, 'Could not load your workflows.')
    }
  } finally {
    loading.value = false
  }
}

onMounted(fetchWorkflows)
watch(isAuthenticated, fetchWorkflows)

const STATUS = {
  active: { label: 'Active', color: 'success' as const },
  paused: { label: 'Paused', color: 'warning' as const },
  draft: { label: 'Draft', color: 'neutral' as const }
}

function updated(workflow: WorkflowSummary) {
  const value = workflow.updatedAt || workflow.createdAt
  if (!value) return ''
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Create
const isCreateOpen = ref(false)
const newTitle = ref('')
const creating = ref(false)

function openCreate() {
  if (unauthorized.value) {
    openAuthModal()
    return
  }
  newTitle.value = ''
  isCreateOpen.value = true
}

async function createWorkflow() {
  const title = newTitle.value.trim()
  if (!title || creating.value) return
  creating.value = true
  try {
    const workflow = await $fetch<WorkflowSummary>('/api/workflows', {
      method: 'POST',
      headers: { [headerName]: csrf() },
      body: {
        title,
        status: 'draft',
        // Start with a trigger that runs on demand so the workflow can be tested right away.
        nodes: [{
          id: 'trigger',
          type: 'trigger',
          position: { x: 80, y: 160 },
          data: { title: 'Manual', subtitle: 'Button click', icon: 'i-lucide-play-circle', color: 'text-amber-500', subtype: 'manual' }
        }],
        edges: []
      }
    })
    isCreateOpen.value = false
    router.push(`/workflows/${workflow.id}`)
  } catch (err: any) {
    toast.add({ title: 'Could not create the workflow', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    creating.value = false
  }
}

// Create from a template
const templates = ref<InstanceType<typeof WorkflowTemplates> | null>(null)
const creatingFromTemplate = ref(false)

async function createFromTemplate({ template, title }: { template: WorkflowTemplate, title: string }) {
  if (creatingFromTemplate.value) return
  if (unauthorized.value || !isAuthenticated.value) {
    templates.value?.close()
    openAuthModal()
    return
  }
  creatingFromTemplate.value = true
  try {
    const { nodes, edges } = instantiateTemplate(template, { model: defaultModel })
    const workflow = await $fetch<WorkflowSummary>('/api/workflows', {
      method: 'POST',
      headers: { [headerName]: csrf() },
      // A draft: nothing runs, and no schedule starts, until the user deploys it.
      body: { title, description: template.description, status: 'draft', nodes, edges }
    })
    templates.value?.close()
    router.push(`/workflows/${workflow.id}`)
  } catch (err: any) {
    toast.add({ title: 'Could not add the template', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    creatingFromTemplate.value = false
  }
}

// Delete
const deleteModal = overlay.create(ModalConfirm)

async function removeWorkflow(workflow: WorkflowSummary) {
  const confirmed = await deleteModal.open({
    title: `Delete "${workflow.title}"?`,
    description: 'The workflow and its run history will be removed. This cannot be undone.',
    color: 'error'
  }).result
  if (!confirmed) return

  try {
    await $fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE', headers: { [headerName]: csrf() } })
    workflows.value = workflows.value.filter(w => w.id !== workflow.id)
    toast.add({ title: 'Workflow deleted', icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not delete the workflow', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

function menuItems(workflow: WorkflowSummary) {
  return [[
    { label: 'Open', icon: 'i-lucide-external-link', onSelect: () => router.push(`/workflows/${workflow.id}`) }
  ], [
    { label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => removeWorkflow(workflow) }
  ]]
}

const isEmpty = computed(() => !loading.value && !unauthorized.value && !loadError.value && workflows.value.length === 0)
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="flex items-start justify-between gap-4 mb-10">
        <div>
          <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Workflows</h1>
          <p class="text-muted text-base md:text-lg">Automations that run on their own, with you in the loop when it matters.</p>
        </div>
        <UButton
          v-if="!unauthorized"
          label="New workflow"
          icon="i-lucide-plus"
          color="neutral"
          class="shrink-0"
          @click="openCreate"
        />
      </div>

      <div
        v-if="unauthorized"
        class="rounded-2xl border border-default bg-elevated/50 p-8 text-center"
      >
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to build workflows</h2>
        <p class="text-sm text-muted mb-5">Workflows are saved to your account and can use the apps you connect.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <div
        v-else-if="loadError"
        class="rounded-2xl border border-default bg-elevated/50 p-8 text-center"
      >
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-cloud-off" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Could not load workflows</h2>
        <p class="text-sm text-muted mb-5">{{ loadError }}</p>
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchWorkflows" />
      </div>

      <div v-else-if="loading" class="py-12 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div
        v-else-if="isEmpty"
        class="rounded-2xl border border-dashed border-default p-10 text-center"
      >
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-workflow" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">No workflows yet</h2>
        <p class="text-sm text-muted mb-5">Build one on the canvas, or describe it in chat and OpenLobs will draft it for you.</p>
        <div class="flex items-center justify-center gap-2">
          <UButton label="New workflow" icon="i-lucide-plus" color="neutral" @click="openCreate" />
          <UButton
            label="Describe it in chat"
            icon="i-lucide-message-circle"
            color="neutral"
            variant="subtle"
            :to="{ path: '/', query: { prompt: 'Create a workflow that ' } }"
          />
        </div>
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          v-for="workflow in workflows"
          :key="workflow.id"
          class="group relative rounded-2xl border border-default bg-default p-5 hover:bg-elevated/60 hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          <RouterLink
            :to="`/workflows/${workflow.id}`"
            class="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-primary"
            :aria-label="`Open ${workflow.title}`"
          />
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="p-2.5 rounded-xl border border-default shadow-sm bg-default">
              <UIcon name="i-lucide-workflow" class="size-5 text-primary" />
            </div>
            <div class="relative flex items-center gap-1">
              <UBadge :label="STATUS[workflow.status]?.label ?? 'Draft'" :color="STATUS[workflow.status]?.color ?? 'neutral'" variant="subtle" size="sm" />
              <UDropdownMenu :items="menuItems(workflow)" :content="{ align: 'end' }">
                <UButton
                  icon="i-lucide-ellipsis"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Workflow actions"
                />
              </UDropdownMenu>
            </div>
          </div>
          <h3 class="text-sm font-semibold text-highlighted mb-1 truncate">{{ workflow.title }}</h3>
          <p class="text-xs text-muted leading-relaxed line-clamp-2 min-h-[2rem]">
            {{ workflow.description || 'No description' }}
          </p>
          <p class="text-[11px] text-dimmed mt-4">
            {{ workflow.nodes?.length ?? 0 }} {{ (workflow.nodes?.length ?? 0) === 1 ? 'step' : 'steps' }}
            <template v-if="updated(workflow)"> · Updated {{ updated(workflow) }}</template>
          </p>
        </div>
      </div>

      <WorkflowTemplates
        v-if="!loading && !loadError"
        ref="templates"
        class="mt-14"
        :creating="creatingFromTemplate"
        @use="createFromTemplate"
      />
    </div>

    <UModal
      v-model:open="isCreateOpen"
      title="New workflow"
      description="Give it a name. You can change it any time."
    >
      <template #body>
        <UInput
          v-model="newTitle"
          placeholder="e.g. Weekly client digest"
          size="lg"
          class="w-full"
          maxlength="120"
          autofocus
          @keydown.enter.prevent="createWorkflow"
        />
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="isCreateOpen = false" />
          <UButton label="Create" color="neutral" :loading="creating" :disabled="!newTitle.trim()" @click="createWorkflow" />
        </div>
      </template>
    </UModal>
  </div>
</template>
