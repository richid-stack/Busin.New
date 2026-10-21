<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, provide } from 'vue'
import { useRoute, onBeforeRouteLeave } from 'vue-router'
import { watchDebounced, debounceFilter, useRefHistory, useMediaQuery, useStorage } from '@vueuse/core'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import dagre from 'dagre'
import { $fetch } from 'ofetch'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import NodePalette from '../../components/workflow/NodePalette.vue'
import NodeCard from '../../components/workflow/NodeCard.vue'
import NodeConfigPanel from '../../components/workflow/NodeConfigPanel.vue'
import CopilotPanel from '../../components/workflow/CopilotPanel.vue'
import RunResultModal from '../../components/workflow/RunResultModal.vue'
import RunHistory from '../../components/workflow/RunHistory.vue'
import type { CopilotMessage } from '../../components/workflow/CopilotPanel.vue'
import { useModels } from '../../composables/useModels'
import { useCsrf } from '../../composables/useCsrf'
import { useIntegrations } from '../../composables/useIntegrations'
import { useIntegrationConnect } from '../../composables/useIntegrationConnect'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { EDGE_STYLE, createNode, knownOutputKeys, serializeGraph } from '../../utils/workflowGraph'
import type { NodeDefinition, NodeRuntime } from '../../utils/workflowGraph'

const route = useRoute()
const toast = useToast()
const { csrf, headerName } = useCsrf()
const { defaultModel } = useModels()
const { openAuthModal } = useFirebaseAuth()
const { integrations, canConnect, fetchIntegrations } = useIntegrations()
const { busyProvider, connect: connectIntegration } = useIntegrationConnect()

const {
  fitView, screenToFlowCoordinate, onConnect, addEdges, removeNodes, removeEdges,
  updateNodeData, getSelectedNodes, getSelectedEdges, onPaneReady
} = useVueFlow()

const workflowId = computed(() => String(route.params.id))
const headers = () => {
  const out: Record<string, string> = {}
  const token = csrf()
  if (token) out[headerName] = token
  return out
}
const errorMessage = (err: any, fallback: string) =>
  err?.data?.statusMessage || err?.statusMessage || err?.data?.message || err?.message || fallback

// ---------------------------------------------------------------------------
// Workflow state
// ---------------------------------------------------------------------------
type LoadState = 'loading' | 'ready' | 'missing' | 'signin' | 'error'
const loadState = ref<LoadState>('loading')
const loadErrorText = ref('')

const nodes = ref<any[]>([])
const edges = ref<any[]>([])
const title = ref('')
const titleDraft = ref('')
const workflowStatus = ref<'active' | 'draft' | 'paused'>('draft')
const webhookSecret = ref<string | undefined>()
const scheduleNextRunAt = ref<string | null>(null)
const scheduleError = ref<string | null>(null)
const hasSchedule = computed(() => nodes.value.some(n => n.type === 'trigger' && n.data?.subtype === 'schedule'))

function applySchedule(result: { schedule?: { nextRunAt: string | null, error: string | null } }) {
  if (!result?.schedule) return
  scheduleNextRunAt.value = result.schedule.nextRunAt
  scheduleError.value = result.schedule.error
}

const selectedId = ref<string | null>(null)
const selectedNode = computed(() => nodes.value.find(n => n.id === selectedId.value) ?? null)

const isMobile = useMediaQuery('(max-width: 1024px)')
const isPaletteOpen = ref(true)
const isPropertiesPanelOpen = ref(false)
const isCopilotOpen = ref(false)
const canvasEl = ref<HTMLElement | null>(null)

/** Run state lives apart from the persisted nodes, so it never reaches autosave or undo. */
const runtime = ref<Record<string, NodeRuntime>>({})
provide('workflowRuntime', runtime)

const webhookUrl = computed(() => `${window.location.origin}/api/webhooks/${workflowId.value}`)

// ---------------------------------------------------------------------------
// Saving and history. Both work on the serialized graph, so selection, measurements and run
// state can never cause a save or an undo step.
// ---------------------------------------------------------------------------
const graph = computed<string>({
  get: () => JSON.stringify(serializeGraph(nodes.value, edges.value)),
  set: (json) => {
    const next = JSON.parse(json)
    nodes.value = next.nodes
    edges.value = next.edges
  }
})

const { undo, redo, canUndo, canRedo, clear: clearHistory } = useRefHistory(graph, {
  capacity: 50,
  eventFilter: debounceFilter(400)
})

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'
const saveStatus = ref<SaveStatus>('saved')
let lastSaved = ''
let saveChain: Promise<unknown> = Promise.resolve()
let saveErrorShown = false

async function doSave() {
  if (loadState.value !== 'ready') return true
  const snapshot = graph.value
  if (snapshot === lastSaved) {
    if (saveStatus.value !== 'saved') saveStatus.value = 'saved'
    return true
  }

  saveStatus.value = 'saving'
  try {
    applySchedule(await $fetch<any>(`/api/workflows/${workflowId.value}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.parse(snapshot)
    }))
    lastSaved = snapshot
    saveStatus.value = graph.value === snapshot ? 'saved' : 'unsaved'
    saveErrorShown = false
    return true
  } catch (err: any) {
    saveStatus.value = 'error'
    if (!saveErrorShown) {
      saveErrorShown = true
      toast.add({
        title: 'Could not save your changes',
        description: errorMessage(err, 'Check your connection. We will keep trying.'),
        icon: 'i-lucide-cloud-off',
        color: 'error'
      })
    }
    return false
  }
}

/** Serialises saves so a slow request can never overwrite a newer one. */
function persist(): Promise<boolean> {
  const next = saveChain.then(doSave, doSave) as Promise<boolean>
  saveChain = next
  return next
}

watch(graph, (value) => {
  if (loadState.value === 'ready' && value !== lastSaved && saveStatus.value !== 'saving') {
    saveStatus.value = 'unsaved'
  }
})
watchDebounced(graph, () => { persist() }, { debounce: 1000, maxWait: 5000 })

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (saveStatus.value === 'unsaved' || saveStatus.value === 'error') {
    event.preventDefault()
  }
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))
onBeforeRouteLeave(async () => {
  await persist()
})

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function loadWorkflow() {
  loadState.value = 'loading'
  try {
    const workflow = await $fetch<any>(`/api/workflows/${workflowId.value}`, { headers: headers() })

    title.value = workflow.title || 'Untitled workflow'
    titleDraft.value = title.value
    workflowStatus.value = workflow.status || 'draft'
    webhookSecret.value = workflow.webhookSecret
    scheduleNextRunAt.value = workflow.scheduleNextRunAt ?? null
    scheduleError.value = workflow.scheduleError ?? null
    nodes.value = workflow.nodes ?? []
    edges.value = (workflow.edges ?? []).map((edge: any) => ({
      ...edge,
      animated: edge.animated ?? true,
      style: edge.style ?? EDGE_STYLE
    }))

    await nextTick()
    lastSaved = graph.value
    saveStatus.value = 'saved'
    clearHistory()
    loadState.value = 'ready'

    setTimeout(() => fitView({ padding: 0.2, includeHiddenNodes: true }), 100)
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status
    if (status === 404) loadState.value = 'missing'
    else if (status === 401 || status === 403) loadState.value = 'signin'
    else {
      loadErrorText.value = errorMessage(err, 'Could not load this workflow.')
      loadState.value = 'error'
    }
  }
}

onMounted(async () => {
  if (isMobile.value) isPaletteOpen.value = false
  fetchIntegrations()
  await loadWorkflow()
})

onPaneReady(() => fitView({ padding: 0.5 }))

// ---------------------------------------------------------------------------
// Title and deployment
// ---------------------------------------------------------------------------
async function commitTitle() {
  const next = titleDraft.value.trim()
  if (!next) {
    titleDraft.value = title.value
    return
  }
  if (next === title.value) return
  try {
    await $fetch(`/api/workflows/${workflowId.value}`, {
      method: 'PUT',
      headers: headers(),
      body: { title: next }
    })
    title.value = next
  } catch (err: any) {
    titleDraft.value = title.value
    toast.add({ title: 'Could not rename the workflow', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const isDeploying = ref(false)
async function toggleDeploy() {
  if (isDeploying.value) return
  const next = workflowStatus.value === 'active' ? 'paused' : 'active'
  isDeploying.value = true
  try {
    if (next === 'active' && !(await persist())) return
    applySchedule(await $fetch<any>(`/api/workflows/${workflowId.value}/status`, {
      method: 'PATCH',
      headers: headers(),
      body: { status: next }
    }))
    workflowStatus.value = next
    toast.add({
      title: next === 'active' ? 'Workflow is live' : 'Workflow paused',
      description: next === 'active'
        ? (hasSchedule.value ? 'It will run on its schedule, and its webhook accepts calls.' : 'Its webhook now accepts calls.')
        : 'It will not run or accept calls until you deploy again.',
      icon: next === 'active' ? 'i-lucide-rocket' : 'i-lucide-pause',
      color: next === 'active' ? 'success' : 'neutral'
    })
  } catch (err: any) {
    toast.add({ title: 'Could not change the deployment', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    isDeploying.value = false
  }
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
const hasSelection = computed(() => getSelectedNodes.value.length + getSelectedEdges.value.length > 0)

function deleteSelection() {
  removeNodes(getSelectedNodes.value.map(n => n.id))
  removeEdges(getSelectedEdges.value.map(e => e.id))
}

function onNodeClick(event: any) {
  selectedId.value = event.node.id
  isPropertiesPanelOpen.value = true
}

function openNode(def: NodeDefinition, position: { x: number, y: number }) {
  const node = createNode(def, position, defaultModel)
  nodes.value = [...nodes.value, node]
  selectedId.value = node.id
  isPropertiesPanelOpen.value = true
}

function handleAddNode(def: NodeDefinition) {
  const rect = canvasEl.value?.getBoundingClientRect()
  const jitter = (nodes.value.length % 6) * 28
  const position = rect
    ? screenToFlowCoordinate({ x: rect.left + rect.width / 2 - 110 + jitter, y: rect.top + rect.height / 2 - 40 + jitter })
    : { x: 100 + jitter, y: 120 + jitter }
  openNode(def, position)
  if (isMobile.value) isPaletteOpen.value = false
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const raw = event.dataTransfer?.getData('application/vueflow')
  if (!raw) return
  let def: NodeDefinition
  try {
    def = JSON.parse(raw)
  } catch {
    return
  }
  if (def.comingSoon) return
  openNode(def, screenToFlowCoordinate({ x: event.clientX - 110, y: event.clientY - 40 }))
}

function reaches(from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const current = stack.pop()!
    if (current === to) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of edges.value) if (edge.source === current) stack.push(edge.target)
  }
  return false
}

onConnect((connection) => {
  const { source, target, sourceHandle } = connection
  if (source === target) return

  if (nodes.value.find(n => n.id === target)?.type === 'trigger') {
    toast.add({ title: 'Triggers start a workflow', description: 'A trigger cannot receive a connection.', icon: 'i-lucide-zap', color: 'warning' })
    return
  }
  if (edges.value.some(e => e.source === source && e.target === target && (e.sourceHandle ?? null) === (sourceHandle ?? null))) return
  if (reaches(target, source)) {
    toast.add({ title: 'That would create a loop', description: 'Steps must flow in one direction.', icon: 'i-lucide-repeat', color: 'warning' })
    return
  }

  addEdges([{
    id: `e-${source}${sourceHandle ? `-${sourceHandle}` : ''}-${target}`,
    source,
    target,
    sourceHandle,
    animated: true,
    style: EDGE_STYLE
  }])
})

function layoutGraph() {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 200 })
  g.setDefaultEdgeLabel(() => ({}))
  nodes.value.forEach(node => g.setNode(node.id, { width: 250, height: 100 }))
  edges.value.forEach(edge => g.setEdge(edge.source, edge.target))
  dagre.layout(g)

  nodes.value = nodes.value.map((node) => {
    const placed = g.node(node.id)
    return { ...node, position: { x: placed.x - 125, y: placed.y - 50 } }
  })
  setTimeout(() => fitView({ padding: 0.5 }), 50)
}

// ---------------------------------------------------------------------------
// Node configuration
// ---------------------------------------------------------------------------
function patchSelected(patch: Record<string, any>) {
  if (selectedId.value) updateNodeData(selectedId.value, patch)
}

const dynamicVariables = computed(() => {
  const variables: Array<{ group: string, label: string, value: string, icon: string }> = []
  for (const node of nodes.value) {
    if (node.id === selectedId.value) continue
    const group = node.data?.title || node.type
    const icon = node.data?.icon || 'i-lucide-box'
    const output = runtime.value[node.id]?.output

    if (output && typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length > 0) {
      for (const key of Object.keys(output)) {
        variables.push({ group, label: key, value: `{{${node.id}.${key}}}`, icon })
      }
      continue
    }
    const known = knownOutputKeys(node)
    if (known) {
      for (const key of known) variables.push({ group, label: key, value: `{{${node.id}.${key}}}`, icon })
      if (node.data?.settings?.onError && node.data.settings.onError !== 'stop') {
        variables.push({ group, label: 'error (if it failed)', value: `{{${node.id}.error}}`, icon })
      }
      continue
    }
    switch (node.type) {
      case 'agent':
      case 'logic':
        variables.push({ group, label: 'Result', value: `{{${node.id}.result}}`, icon })
        if (node.data?.settings?.onError && node.data.settings.onError !== 'stop') {
          variables.push({ group, label: 'error (if it failed)', value: `{{${node.id}.error}}`, icon })
        }
        break
      case 'approval':
        variables.push({ group, label: 'Approved', value: `{{${node.id}.approved}}`, icon })
        break
      default:
        variables.push({ group, label: node.type === 'trigger' ? 'Payload' : 'Output', value: `{{${node.id}}}`, icon })
    }
  }
  return variables
})

async function connectProvider(provider: string) {
  const connected = await connectIntegration(provider)
  if (connected) await fetchIntegrations()
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------
const defaultPayload = '{\n  "message": "Hello from a test run"\n}'
const testPayload = useStorage(`openlobs:test-payload:${workflowId.value}`, defaultPayload)
const payloadError = computed(() => {
  try {
    const parsed = JSON.parse(testPayload.value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : 'The payload must be a JSON object.'
  } catch (error: any) {
    return `Invalid JSON: ${error?.message || 'could not parse'}`
  }
})

const isPayloadModalOpen = ref(false)
const isRunModalOpen = ref(false)
const isExecuting = ref(false)
const executionRun = ref<any | null>(null)
const executionError = ref<string | null>(null)

function applyRunToCanvas(run: any) {
  const next: Record<string, NodeRuntime> = {}
  for (const log of run?.logs ?? []) {
    next[log.nodeId] = { status: log.status, durationMs: log.durationMs, output: log.output, message: log.message }
  }
  runtime.value = next
}

async function runWorkflow() {
  if (payloadError.value) return
  isPayloadModalOpen.value = false

  executionRun.value = null
  executionError.value = null
  isExecuting.value = true
  isRunModalOpen.value = true

  try {
    // A run executes the saved workflow, so make sure the latest edits are saved first.
    if (!(await persist())) {
      executionError.value = 'Your latest changes could not be saved, so the run was not started.'
      return
    }

    runtime.value = Object.fromEntries(nodes.value.map(n => [n.id, { status: 'running' } as NodeRuntime]))
    const data = await $fetch<{ run: any }>(`/api/workflows/${workflowId.value}/run`, {
      method: 'POST',
      headers: headers(),
      body: { input: JSON.parse(testPayload.value) }
    })
    executionRun.value = data.run
    applyRunToCanvas(data.run)
    if (isHistoryOpen.value) loadRuns()
  } catch (err: any) {
    runtime.value = {}
    executionError.value = errorMessage(err, 'The run could not be started.')
  } finally {
    isExecuting.value = false
  }
}

function onRunUpdated(run: any) {
  executionRun.value = run
  applyRunToCanvas(run)
  loadRuns()
}

const isTestingNode = ref(false)
const nodeTestResult = ref<any | null>(null)
watch(selectedId, () => { nodeTestResult.value = null })

async function testNode(inputs: Record<string, any>) {
  const node = selectedNode.value
  if (!node) return
  isTestingNode.value = true
  nodeTestResult.value = null
  runtime.value = { ...runtime.value, [node.id]: { status: 'running' } }

  try {
    const [plain] = serializeGraph([node], []).nodes
    const data = await $fetch<{ result: any }>(`/api/workflows/${workflowId.value}/test-node`, {
      method: 'POST',
      headers: headers(),
      body: { node: plain, inputs }
    })
    nodeTestResult.value = data.result
    runtime.value = {
      ...runtime.value,
      [node.id]: { status: data.result.status, durationMs: data.result.durationMs, output: data.result.output, message: data.result.message }
    }
  } catch (err: any) {
    nodeTestResult.value = { status: 'failed', message: errorMessage(err, 'The step could not be tested.') }
    runtime.value = { ...runtime.value, [node.id]: { status: 'failed' } }
  } finally {
    isTestingNode.value = false
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
const isHistoryOpen = ref(false)
const runs = ref<any[]>([])
const isLoadingRuns = ref(false)

async function loadRuns() {
  isLoadingRuns.value = true
  try {
    runs.value = await $fetch<any[]>(`/api/workflows/${workflowId.value}/runs`, { headers: headers() })
  } catch (err: any) {
    toast.add({ title: 'Could not load run history', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    isLoadingRuns.value = false
  }
}
watch(isHistoryOpen, (open) => { if (open) loadRuns() })

function openPastRun(run: any) {
  executionRun.value = run
  executionError.value = null
  isExecuting.value = false
  applyRunToCanvas(run)
  isRunModalOpen.value = true
}

// ---------------------------------------------------------------------------
// Copilot
// ---------------------------------------------------------------------------
const copilotMessages = ref<CopilotMessage[]>([
  { role: 'assistant', text: 'Hi! Tell me how to change this workflow and I will update the canvas. You can undo anything I change.' }
])
const isCopilotLoading = ref(false)

async function runCopilot(prompt: string) {
  if (isCopilotLoading.value) return
  copilotMessages.value.push({ role: 'user', text: prompt })
  isCopilotLoading.value = true

  try {
    const response = await $fetch<any>('/api/workflows/copilot', {
      method: 'POST',
      headers: headers(),
      body: { prompt, nodes: serializeGraph(nodes.value, edges.value).nodes, edges: serializeGraph(nodes.value, edges.value).edges }
    })

    if (response?.success && response.nodes) {
      nodes.value = response.nodes
      edges.value = (response.edges ?? []).map((edge: any) => ({ ...edge, animated: true, style: edge.style ?? EDGE_STYLE }))
      copilotMessages.value.push({ role: 'assistant', text: response.summary || 'I updated the canvas.' })
      setTimeout(layoutGraph, 50)
    } else {
      copilotMessages.value.push({ role: 'assistant', text: 'I could not make that change. Try describing it differently.' })
    }
  } catch (err: any) {
    copilotMessages.value.push({ role: 'assistant', text: errorMessage(err, 'Something went wrong while changing the workflow.') })
  } finally {
    isCopilotLoading.value = false
  }
}

const saveLabel = computed(() => ({ saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Not saved' }[saveStatus.value]))
</script>

<template>
  <UDashboardPanel
    id="workflow-studio"
    class="relative min-h-0 flex-1 h-full w-full"
    :ui="{ body: 'p-0 sm:p-0 gap-0 sm:gap-0 overflow-hidden overscroll-none' }"
  >
    <template #header>
      <UDashboardNavbar :ui="{ left: 'min-w-0', right: 'gap-1.5 sm:gap-2' }">
        <template #left>
          <div class="flex items-center gap-2 sm:gap-3 min-w-0">
            <UButton
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              size="sm"
              to="/workflows"
              aria-label="All workflows"
            />
            <div class="min-w-0">
              <UInput
                v-model="titleDraft"
                variant="none"
                size="sm"
                class="w-full max-w-[14rem] sm:max-w-xs"
                :ui="{ base: 'p-0 font-semibold text-default leading-tight' }"
                aria-label="Workflow name"
                :disabled="loadState !== 'ready'"
                maxlength="120"
                @blur="commitTitle"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              />
              <p class="text-xs text-muted flex items-center gap-1.5">
                <span
                  class="size-1.5 rounded-full"
                  :class="workflowStatus === 'active' ? 'bg-success' : 'bg-muted'"
                />
                {{ workflowStatus === 'active' ? 'Active' : workflowStatus === 'paused' ? 'Paused' : 'Draft' }}
              </p>
            </div>
          </div>
        </template>

        <template #right>
        <template v-if="loadState === 'ready'">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-blocks"
            size="sm"
            to="/integrations"
            aria-label="Integrations"
          >
            <span class="hidden xl:inline">Integrations</span>
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-activity"
            size="sm"
            aria-label="Execution history"
            @click="isHistoryOpen = true"
          >
            <span class="hidden xl:inline">History</span>
          </UButton>
          <div class="w-px h-4 bg-border mx-0.5" />
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-play"
            size="sm"
            aria-label="Test run"
            @click="isPayloadModalOpen = true"
          >
            <span class="hidden sm:inline">Test Run</span>
          </UButton>
          <button
            type="button"
            class="flex items-center gap-1 text-xs mr-1 rounded-md px-1"
            :class="saveStatus === 'error' ? 'text-error cursor-pointer' : 'text-muted cursor-default'"
            :disabled="saveStatus !== 'error'"
            @click="persist()"
          >
            <UIcon v-if="saveStatus === 'saving'" name="i-lucide-refresh-cw" class="animate-spin size-3" />
            <UIcon v-else-if="saveStatus === 'saved'" name="i-lucide-check" class="size-3 text-success" />
            <UIcon v-else-if="saveStatus === 'unsaved'" name="i-lucide-circle-dot" class="size-3" />
            <UIcon v-else name="i-lucide-triangle-alert" class="size-3" />
            <span class="hidden lg:inline">{{ saveLabel }}</span>
            <span v-if="saveStatus === 'error'" class="hidden lg:inline underline">Retry</span>
          </button>
          <UButton
            :color="workflowStatus === 'active' ? 'success' : 'primary'"
            :variant="workflowStatus === 'active' ? 'soft' : 'solid'"
            :icon="workflowStatus === 'active' ? 'i-lucide-circle-check' : 'i-lucide-rocket'"
            :label="workflowStatus === 'active' ? 'Active' : 'Deploy'"
            :title="workflowStatus === 'active' ? 'Click to pause' : 'Make the webhook live'"
            size="sm"
            :loading="isDeploying"
            @click="toggleDeploy"
          />
        </template>
        <UColorModeButton />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>

    <!-- Loading and failure states -->
    <div v-if="loadState === 'loading'" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </div>

    <div v-else-if="loadState !== 'ready'" class="flex-1 flex items-center justify-center px-6">
      <div class="max-w-sm text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-elevated/50 shadow-sm flex items-center justify-center">
          <UIcon
            :name="loadState === 'signin' ? 'i-lucide-lock' : loadState === 'missing' ? 'i-lucide-search-x' : 'i-lucide-cloud-off'"
            class="size-5 text-muted"
          />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">
          {{ loadState === 'signin' ? 'Sign in to open this workflow' : loadState === 'missing' ? 'Workflow not found' : 'Could not load this workflow' }}
        </h2>
        <p class="text-sm text-muted mb-5">
          {{
            loadState === 'signin' ? 'Workflows are tied to your account.'
            : loadState === 'missing' ? 'It may have been deleted, or it belongs to another account.'
            : loadErrorText
          }}
        </p>
        <div class="flex items-center justify-center gap-2">
          <UButton v-if="loadState === 'signin'" label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
          <UButton v-else-if="loadState === 'error'" label="Try again" icon="i-lucide-refresh-cw" color="neutral" @click="loadWorkflow" />
          <UButton label="All workflows" to="/workflows" color="neutral" variant="subtle" />
        </div>
      </div>
    </div>

    <div v-else class="flex flex-1 min-h-0 relative overflow-hidden">
      <!-- Node library -->
      <div
        v-if="isPaletteOpen"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
        @click="isPaletteOpen = false"
      />
      <div
        v-show="isPaletteOpen"
        class="absolute inset-y-0 left-0 z-50 lg:relative lg:z-auto h-full shadow-2xl lg:shadow-none"
      >
        <NodePalette @add-node="handleAddNode" @close="isPaletteOpen = false" />
      </div>

      <!-- Canvas -->
      <div
        ref="canvasEl"
        class="flex-1 h-full relative min-w-0"
        :class="{ 'lg:mr-96': isPropertiesPanelOpen }"
      >
        <div class="absolute top-3 left-3 z-10 flex items-center gap-1 sm:gap-2 bg-elevated/95 backdrop-blur-sm p-1 sm:p-1.5 rounded-xl border border-default shadow-sm max-w-[calc(100vw-6rem)] overflow-x-auto no-scrollbar">
          <UButton color="neutral" variant="ghost" icon="i-lucide-panel-left" size="xs" title="Toggle node library" aria-label="Toggle node library" @click="isPaletteOpen = !isPaletteOpen" />
          <div class="w-px h-4 bg-border" />
          <UButton color="primary" variant="soft" icon="i-lucide-sparkles" size="xs" title="AI Copilot" aria-label="AI Copilot" @click="isCopilotOpen = !isCopilotOpen" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-layout-dashboard" size="xs" title="Tidy layout" aria-label="Tidy layout" @click="layoutGraph" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-undo-2" size="xs" :disabled="!canUndo" title="Undo" aria-label="Undo" @click="undo()" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-redo-2" size="xs" :disabled="!canRedo" title="Redo" aria-label="Redo" @click="redo()" />
          <div class="w-px h-4 bg-border" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-trash-2" size="xs" :disabled="!hasSelection" title="Delete selected" aria-label="Delete selected" @click="deleteSelection" />
        </div>

        <div v-if="!isPropertiesPanelOpen" class="absolute top-3 right-3 z-10">
          <UButton color="neutral" variant="solid" icon="i-lucide-panel-right-open" size="xs" class="shadow-sm" label="Config" @click="isPropertiesPanelOpen = true" />
        </div>

        <!-- Empty canvas -->
        <div
          v-if="nodes.length === 0"
          class="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none px-6"
        >
          <div class="pointer-events-auto max-w-sm text-center rounded-2xl border border-default bg-elevated/80 backdrop-blur p-8 shadow-sm">
            <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
              <UIcon name="i-lucide-workflow" class="size-5 text-muted" />
            </div>
            <h3 class="text-base font-semibold text-highlighted mb-1">Start your workflow</h3>
            <p class="text-sm text-muted mb-5">Add a trigger from the library, or describe what you want and let the Copilot build it.</p>
            <div class="flex items-center justify-center gap-2">
              <UButton label="Open library" icon="i-lucide-panel-left" color="neutral" variant="subtle" size="sm" @click="isPaletteOpen = true" />
              <UButton label="Ask Copilot" icon="i-lucide-sparkles" color="primary" size="sm" @click="isCopilotOpen = true" />
            </div>
          </div>
        </div>

        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          class="w-full h-full"
          :default-zoom="1"
          :min-zoom="0.2"
          :max-zoom="4"
          @node-click="onNodeClick"
          @pane-click="selectedId = null"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <Background pattern-color="var(--ui-border-accented)" :gap="24" :size="1" />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" />

          <template #node-trigger="{ id, data, selected }">
            <NodeCard :id="id" kind="trigger" :data="data" :selected="selected" />
          </template>
          <template #node-agent="{ id, data, selected }">
            <NodeCard :id="id" kind="agent" :data="data" :selected="selected" />
          </template>
          <template #node-action="{ id, data, selected }">
            <NodeCard :id="id" kind="action" :data="data" :selected="selected" />
          </template>
          <template #node-logic="{ id, data, selected }">
            <NodeCard :id="id" kind="logic" :data="data" :selected="selected" />
          </template>
          <template #node-approval="{ id, data, selected }">
            <NodeCard :id="id" kind="approval" :data="data" :selected="selected" />
          </template>
        </VueFlow>

        <!-- Mobile quick dock -->
        <div class="lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-elevated/95 backdrop-blur-md px-3 py-1.5 rounded-full border border-default shadow-xl">
          <UButton color="neutral" variant="subtle" icon="i-lucide-plus" size="xs" label="Node" @click="isPaletteOpen = true" />
          <div class="w-px h-3.5 bg-border" />
          <UButton color="primary" variant="soft" icon="i-lucide-sparkles" size="xs" title="AI Copilot" aria-label="AI Copilot" @click="isCopilotOpen = true" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-play" size="xs" title="Test run" aria-label="Test run" @click="isPayloadModalOpen = true" />
          <UButton v-if="selectedNode" color="neutral" variant="subtle" icon="i-lucide-sliders-horizontal" size="xs" label="Config" @click="isPropertiesPanelOpen = true" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-maximize-2" size="xs" title="Fit view" aria-label="Fit view" @click="() => fitView({ padding: 0.2 })" />
        </div>
      </div>

      <!-- Copilot -->
      <div
        v-if="isCopilotOpen"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
        @click="isCopilotOpen = false"
      />
      <div
        v-if="isCopilotOpen"
        class="w-[85vw] sm:w-80 md:w-96 border-l border-default bg-elevated h-full shrink-0 z-50 absolute right-0 top-0 bottom-0 shadow-2xl"
        :class="{ 'lg:right-96': isPropertiesPanelOpen }"
      >
        <CopilotPanel
          :messages="copilotMessages"
          :loading="isCopilotLoading"
          @send="runCopilot"
          @close="isCopilotOpen = false"
        />
      </div>

      <!-- Node configuration -->
      <div
        v-if="isPropertiesPanelOpen"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
        @click="isPropertiesPanelOpen = false"
      />
      <div
        v-if="isPropertiesPanelOpen"
        class="w-[85vw] sm:w-96 border-l border-default bg-elevated h-full shrink-0 z-50 absolute right-0 top-0 bottom-0 shadow-2xl lg:shadow-none"
      >
        <NodeConfigPanel
          :node="selectedNode"
          :variables="dynamicVariables"
          :integrations="integrations"
          :can-connect="canConnect"
          :connecting-provider="busyProvider"
          :webhook-url="webhookUrl"
          :webhook-secret="webhookSecret"
          :workflow-active="workflowStatus === 'active'"
          :schedule-next-run-at="scheduleNextRunAt"
          :schedule-error="scheduleError"
          :runtime="selectedId ? runtime[selectedId] : undefined"
          :testing="isTestingNode"
          :test-result="nodeTestResult"
          @close="isPropertiesPanelOpen = false"
          @update="patchSelected"
          @connect="connectProvider"
          @test="testNode"
        />
      </div>
    </div>

    <!-- Test run payload -->
    <UModal
      v-model:open="isPayloadModalOpen"
      title="Test run"
      description="This JSON is handed to the trigger as its payload."
    >
      <template #body>
        <UFormField :error="payloadError || undefined" help="Saved on this device for next time.">
          <UTextarea v-model="testPayload" class="w-full" :ui="{ base: 'font-mono text-xs' }" :rows="12" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex items-center justify-between w-full gap-2">
          <UButton label="Reset" color="neutral" variant="ghost" size="sm" @click="testPayload = defaultPayload" />
          <div class="flex items-center gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" size="sm" @click="isPayloadModalOpen = false" />
            <UButton label="Run" color="primary" size="sm" icon="i-lucide-play" :disabled="Boolean(payloadError)" @click="runWorkflow" />
          </div>
        </div>
      </template>
    </UModal>

    <RunResultModal
      v-model:open="isRunModalOpen"
      :workflow-id="workflowId"
      :executing="isExecuting"
      :run="executionRun"
      :error="executionError"
      @run-updated="onRunUpdated"
    />

    <RunHistory
      v-model:open="isHistoryOpen"
      :runs="runs"
      :loading="isLoadingRuns"
      @select="openPastRun"
      @refresh="loadRuns"
    />
    </template>
  </UDashboardPanel>
</template>

<style>
/* Vue Flow overrides for our theme */
.vue-flow__node {
  border-radius: 0.75rem;
}
.vue-flow__edge-path {
  stroke-dasharray: 5;
  animation: dashdraw 30s linear infinite;
}
@keyframes dashdraw {
  from {
    stroke-dashoffset: 1000;
  }
}
.vue-flow__minimap {
  background-color: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  overflow: hidden;
}
.vue-flow__minimap-mask {
  fill: var(--ui-bg);
  opacity: 0.6;
}
.vue-flow__minimap-node {
  fill: var(--ui-primary);
  opacity: 0.5;
}
.vue-flow__controls {
  background-color: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
.vue-flow__controls-button {
  background-color: transparent;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text);
  transition: background-color 0.15s ease;
}
.vue-flow__controls-button:hover {
  background-color: var(--ui-bg-accented);
}
.vue-flow__controls-button:last-child {
  border-bottom: none;
}
</style>
