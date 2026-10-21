<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { watchDebounced, useClipboard, useRefHistory, useMediaQuery } from '@vueuse/core'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { Handle, Position } from '@vue-flow/core'
import dagre from 'dagre'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import Navbar from '../../components/Navbar.vue'
import NodePalette from '../../components/workflow/NodePalette.vue'
import VariablePicker from '../../components/workflow/VariablePicker.vue'
import VariableTextarea from '../../components/workflow/VariableTextarea.vue'
import { useModels } from '../../composables/useModels'
import { useRoute } from 'vue-router'
import { useCsrf } from '../../composables/useCsrf'
import { $fetch } from 'ofetch'

const { onPaneReady, fitView, project, onConnect, addEdges, removeNodes, removeEdges } = useVueFlow()
const { csrf, headerName } = useCsrf()
const { models } = useModels()
const route = useRoute()

const getHeaders = () => {
  const headers: Record<string, string> = {}
  const token = csrf()
  if (token) headers[headerName] = token
  return headers
}

const nodes = ref<any[]>([
  { id: 'trigger', type: 'trigger', position: { x: 50, y: 150 }, data: { title: 'New Email Received', subtitle: 'Gmail', icon: 'i-logos-google-gmail' } },
  { id: 'ai-triage', type: 'agent', position: { x: 350, y: 150 }, data: { title: 'AI Triage Agent', subtitle: 'Gemini 3.5 Flash', icon: 'i-lucide-brain', color: 'text-primary' } },
  { id: 'ai-writer', type: 'agent', position: { x: 650, y: 50 }, data: { title: 'Proposal Writer', subtitle: 'Gemini 3.5 Flash', icon: 'i-lucide-pen-tool', color: 'text-primary' } },
  { id: 'ai-scheduler', type: 'agent', position: { x: 650, y: 250 }, data: { title: 'Meeting Scheduler', subtitle: 'Gemini 3.5 Flash', icon: 'i-lucide-calendar', color: 'text-primary' } },
  { id: 'action-docs', type: 'action', position: { x: 950, y: 50 }, data: { title: 'Create Google Doc', subtitle: 'Google Workspace', icon: 'i-logos-google-drive', provider: 'google_docs' } },
  { id: 'action-slack', type: 'action', position: { x: 950, y: 250 }, data: { title: 'Alert Team', subtitle: 'Slack', icon: 'i-logos-slack-icon', provider: 'slack', channel: '#sales-alerts' } }
])

const edges = ref<any[]>([
  { id: 'e-trigger-triage', source: 'trigger', target: 'ai-triage', animated: true, style: { stroke: 'var(--ui-primary)', strokeWidth: 2 } },
  { id: 'e-triage-writer', source: 'ai-triage', target: 'ai-writer', animated: true, style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 } },
  { id: 'e-triage-scheduler', source: 'ai-triage', target: 'ai-scheduler', animated: true, style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 } },
  { id: 'e-writer-docs', source: 'ai-writer', target: 'action-docs', animated: true, style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 } },
  { id: 'e-scheduler-slack', source: 'ai-scheduler', target: 'action-slack', animated: true, style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 } }
])

const isPaletteOpen = ref(true)
const isPropertiesPanelOpen = ref(true)
const isCopilotOpen = ref(false)
const isMobile = useMediaQuery('(max-width: 1024px)')

const handleAddNode = (nodeData: any) => {
  const newNode = {
    id: `node-${Date.now()}`,
    type: nodeData.type,
    position: {
      x: 100 + Math.floor(Math.random() * 80),
      y: 120 + (nodes.value.length * 80) % 360
    },
    data: {
      title: nodeData.title,
      subtitle: nodeData.subtitle,
      icon: nodeData.icon,
      color: nodeData.color,
      subtype: nodeData.subtype,
      ...nodeData.defaultData
    }
  }
  nodes.value = [...nodes.value, newNode]
  selectedNode.value = newNode
  isPropertiesPanelOpen.value = true
  
  if (isMobile.value) {
    isPaletteOpen.value = false
  }
}
const copilotPrompt = ref("")
const isCopilotLoading = ref(false)
const copilotChat = ref([{ role: "assistant", text: "Hi! I am your AI Workflow Copilot. How can I help you modify this graph?" }])
const selectedNode = ref<any>(null)
const isTestRunDrawerOpen = ref(false)
const isTestPayloadModalOpen = ref(false)
const testPayload = ref(`{
  "email": {
    "id": "msg_98124",
    "sender": "sarah.connor@acme-corp.com",
    "senderName": "Sarah Connor",
    "subject": "Urgent: Enterprise Security Onboarding & Scope Proposal",
    "date": new Date().toISOString(),
    "body": "Hi Team,\\n\\nWe would like to accelerate our enterprise onboarding kickoff for next Tuesday at 2:00 PM EST. Could you please prepare and share a custom PDF proposal detailing your multi-region cloud security guarantees, SLA tiers, and enterprise pricing?\\n\\nLooking forward to speaking with you.\\n\\nBest regards,\\nSarah Connor\\nVP Engineering, Acme Corp"
  }
}`)
const isExecuting = ref(false)
const isSaving = ref(false)
const saveStatus = ref<'saved' | 'saving' | 'error'>('saved')
const workflowStatus = ref('draft')
const executionResult = ref<any>(null)
const executionError = ref<string | null>(null)
const userIntegrations = ref<any[]>([])
const activePropertiesTab = ref<'config' | 'test'>('config')
const isTestingNode = ref(false)
const nodeTestInput = ref('{\n  "mock_data": "value"\n}')
const nodeTestResult = ref<any>(null)
const isLogsPanelOpen = ref(false)
const workflowRuns = ref<any[]>([])
const isLoadingRuns = ref(false)

const dynamicVariables = computed(() => {
  const vars = []
  for (const node of nodes.value) {
    if (selectedNode.value && node.id === selectedNode.value.id) continue
    
    let outputKeys: string[] = []
    if (node.data.output && typeof node.data.output === 'object') {
      outputKeys = Object.keys(node.data.output)
    }
    
    if (outputKeys.length === 0) {
      if (node.type === 'trigger') {
        vars.push({ group: node.data.title || 'Trigger', label: 'Payload', value: `{{${node.id}.payload}}`, icon: node.data.icon || 'i-lucide-zap' })
      } else if (node.type === 'agent') {
        vars.push({ group: node.data.title || 'Agent', label: 'Result', value: `{{${node.id}.result}}`, icon: node.data.icon || 'i-lucide-bot' })
      } else {
        vars.push({ group: node.data.title || node.type, label: 'Output', value: `{{${node.id}.output}}`, icon: node.data.icon || 'i-lucide-box' })
      }
    } else {
      for (const key of outputKeys) {
        vars.push({
          group: node.data.title || node.type,
          label: key,
          value: `{{${node.id}.${key}}}`,
          icon: node.data.icon || 'i-lucide-box'
        })
      }
    }
  }
  return vars
})

const { undo: undoNodes, redo: redoNodes, canUndo: canUndoNodes, canRedo: canRedoNodes } = useRefHistory(nodes, { deep: true })
const { undo: undoEdges, redo: redoEdges, canUndo: canUndoEdges, canRedo: canRedoEdges } = useRefHistory(edges, { deep: true })

const canUndo = computed(() => canUndoNodes.value || canUndoEdges.value)
const canRedo = computed(() => canRedoNodes.value || canRedoEdges.value)

function undo() {
  if (canUndoNodes.value) undoNodes()
  if (canUndoEdges.value) undoEdges()
}

function redo() {
  if (canRedoNodes.value) redoNodes()
  if (canRedoEdges.value) redoEdges()
}

const { copy, copied } = useClipboard()

const webhookUrl = computed(() => `https://ais-dev-3agg2chahrbxt3gs47q26e-61039750765.europe-west1.run.app/api/webhooks/${route.query.id || 'default'}`)

function copyWebhook() {
  copy(webhookUrl.value)
}

onConnect((connection) => {
  addEdges([{
    id: `e-${connection.source}-${connection.target}`,
    source: connection.source,
    target: connection.target,
    animated: true,
    style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 }
  }])
})

// Drag and drop
const onDragOver = (event: DragEvent) => {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

const onDrop = (event: DragEvent) => {
  event.preventDefault()
  if (!event.dataTransfer) return
  
  const data = event.dataTransfer.getData('application/vueflow')
  if (!data) return
  
  const nodeDef = JSON.parse(data)
  
  const position = project({
    x: event.clientX - 250, // rough offset
    y: event.clientY - 100
  })

  const newNode = {
    id: `${nodeDef.type}-${crypto.randomUUID().slice(0, 8)}`,
    type: nodeDef.type,
    position,
    data: {
      title: nodeDef.title,
      subtitle: nodeDef.subtitle,
      icon: nodeDef.icon,
      color: nodeDef.color,
      ...nodeDef.type === 'agent' ? { model: 'google/gemini-3.5-flash', prompt: '' } : {},
      ...nodeDef.type === 'action' ? { provider: '' } : {}
    }
  }

  nodes.value.push(newNode)
  selectedNode.value = newNode
  isPropertiesPanelOpen.value = true
}

// Auto-Layout
const layoutGraph = () => {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 200 })
  g.setDefaultEdgeLabel(() => ({}))

  nodes.value.forEach(node => {
    g.setNode(node.id, { width: 250, height: 100 })
  })

  edges.value.forEach(edge => {
    g.setEdge(edge.source, edge.target)
  })

  dagre.layout(g)

  nodes.value = nodes.value.map(node => {
    const nodeWithPosition = g.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 125,
        y: nodeWithPosition.y - 50
      }
    }
  })

  setTimeout(() => {
    fitView({ padding: 0.5 })
  }, 50)
}

async function loadIntegrations() {
  try {
    const data = await $fetch<any[]>('/api/integrations', {
      headers: getHeaders()
    }).catch(() => null)
    if (data && Array.isArray(data)) {
      userIntegrations.value = data
    }
  } catch (e) {
    console.warn('Could not load user integrations:', e)
  }
}

async function loadWorkflowRuns() {
  isLoadingRuns.value = true
  const workflowId = route.query.id as string || 'client-onboarding-pipeline'
  try {
    const data = await $fetch<any[]>(`/api/workflows/${workflowId}/runs`, {
      headers: getHeaders()
    }).catch(() => [])
    workflowRuns.value = data || []
  } catch (e) {
    console.warn('Could not load workflow runs:', e)
  } finally {
    isLoadingRuns.value = false
  }
}

watch(isLogsPanelOpen, (isOpen) => {
  if (isOpen) loadWorkflowRuns()
})

onMounted(async () => {
  if (isMobile.value) {
    isPaletteOpen.value = false
    isPropertiesPanelOpen.value = false
  }

  if (window.opener && window.name !== '') {
    window.opener.postMessage({ type: 'COMPOSIO_AUTH_SUCCESS' }, '*')
    window.close()
    return
  }
  await loadIntegrations()
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'COMPOSIO_AUTH_SUCCESS') {
      loadIntegrations()
    }
  })

  const workflowId = route.query.id as string
  try {
    let workflow = null
    if (workflowId) {
      workflow = await $fetch<any>(`/api/workflows/${workflowId}`, {
        headers: getHeaders()
      }).catch(() => null)
    }
    if (!workflow) {
      const list = await $fetch<any[]>('/api/workflows', {
        headers: getHeaders()
      }).catch(() => null)
      if (list && list.length > 0) workflow = list[0]
    }
    if (workflow) {
      nodes.value = workflow.nodes || []
      edges.value = workflow.edges || []
      setTimeout(() => {
        fitView({ padding: 0.2, includeHiddenNodes: true })
      }, 100)
    }
  } catch (err) {
    console.warn('Could not load workflow:', err)
  }
})

const { updateNodeData } = useVueFlow()
const onNodeDataChange = () => {
  if (selectedNode.value) {
    updateNodeData(selectedNode.value.id, { ...selectedNode.value.data })
  }
}


async function runCopilot() {
  if (!copilotPrompt.value.trim() || isCopilotLoading.value) return
  const userText = copilotPrompt.value
  copilotChat.value.push({ role: 'user', text: userText })
  copilotPrompt.value = ''
  isCopilotLoading.value = true
  
  try {
    const res = await $fetch('/api/workflows/copilot', {
      method: 'POST',
      headers: getHeaders(),
      body: {
        prompt: userText,
        nodes: nodes.value,
        edges: edges.value
      }
    })
    
    if (res.success && res.nodes) {
      nodes.value = res.nodes
      edges.value = res.edges
      copilotChat.value.push({ role: 'assistant', text: res.summary || 'I have updated the canvas based on your request.' })
      setTimeout(layoutGraph, 50)
    }
  } catch (err) {
    copilotChat.value.push({ role: 'assistant', text: 'Sorry, I encountered an error modifying the graph.' })
    console.error(err)
  } finally {
    isCopilotLoading.value = false
  }
}

const onNodeClick = (event: any) => {
  selectedNode.value = event.node
  isPropertiesPanelOpen.value = true
}

const selectedIntegration = computed(() => {
  if (!selectedNode.value || !selectedNode.value.data?.provider) return null
  return userIntegrations.value.find(i => i.provider === selectedNode.value.data.provider)
})

async function connectSelectedProvider(provider: string) {
  try {
    const data = await $fetch<any>('/api/integrations/connect', {
      method: 'POST',
      headers: getHeaders(),
      body: {
        provider,
        callbackUrl: window.location.origin + '/workflows'
      }
    })
    if (data?.redirectUrl) {
      const popup = window.open(data.redirectUrl, `Connect_${provider}`, 'width=600,height=750')
      const timer = setInterval(async () => {
        if (!popup || popup.closed) {
          clearInterval(timer)
          await loadIntegrations()
        }
      }, 1000)
    } else {
      await loadIntegrations()
    }
  } catch (err) {
    console.error('Error connecting provider:', err)
  }
}

function handleProviderChange(newProvider: string) {
  if (!selectedNode.value) return
  const match = userIntegrations.value.find(i => i.provider === newProvider)
  selectedNode.value.data.provider = newProvider
  if (match) {
    selectedNode.value.data.icon = match.icon
    selectedNode.value.data.subtitle = `Action • ${match.name}`
  }
}

async function saveWorkflow() {
  saveStatus.value = 'saving'
  isSaving.value = true
  try {
    const workflowId = route.query.id as string || 'client-onboarding-pipeline'
    await $fetch(`/api/workflows/${workflowId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: {
        nodes: nodes.value,
        edges: edges.value,
      }
    })
    saveStatus.value = 'saved'
  } catch (err: any) {
    console.error('Failed to save workflow:', err)
    saveStatus.value = 'error'
  } finally {
    isSaving.value = false
  }
}

watchDebounced([nodes, edges], () => {
  saveWorkflow()
}, { deep: true, debounce: 1000, maxWait: 5000 })

async function deployWorkflow() {
  try {
    const workflowId = route.query.id as string || 'client-onboarding-pipeline'
    const newStatus = workflowStatus.value === 'active' ? 'draft' : 'active'
    await $fetch(`/api/workflows/${workflowId}/status`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: { status: newStatus }
    })
    workflowStatus.value = newStatus
  } catch (err: any) {
    console.error('Failed to deploy workflow:', err)
  }
}

function openTestPayloadModal() {
  isTestPayloadModalOpen.value = true
}

async function runTestWorkflow() {
  isTestPayloadModalOpen.value = false
  isExecuting.value = true
  executionError.value = null
  executionResult.value = null
  isTestRunDrawerOpen.value = true

  // Set visual running status on nodes
  nodes.value.forEach(n => {
    n.data.status = 'running'
  })

  try {
    let parsedInput = {}
    try {
      parsedInput = JSON.parse(testPayload.value)
    } catch {
      console.warn('Invalid JSON in test payload, using empty object')
    }

    const data = await $fetch<any>('/api/workflows/client-onboarding-pipeline/run', {
      method: 'POST',
      headers: getHeaders(),
      body: {
        input: parsedInput
      }
    })

    executionResult.value = data

    // Update individual node statuses from logs
    if (data.logs && Array.isArray(data.logs)) {
      data.logs.forEach((logItem: any) => {
        const node = nodes.value.find(n => n.id === logItem.nodeId)
        if (node) {
          node.data.status = logItem.status
          node.data.durationMs = logItem.durationMs
          node.data.output = logItem.output
        }
      })
    }
  } catch (err: any) {
    executionError.value = err?.data?.message || err?.message || 'Workflow run failed'
    nodes.value.forEach(n => {
      if (n.data.status === 'running') {
        n.data.status = 'failed'
      }
    })
  } finally {
    isExecuting.value = false
  }
}

async function runTestNode() {
  if (!selectedNode.value) return
  isTestingNode.value = true
  nodeTestResult.value = null
  selectedNode.value.data.status = 'running'

  try {
    let parsedInput = {}
    try {
      parsedInput = JSON.parse(nodeTestInput.value)
    } catch {
      console.warn('Invalid JSON in test input, sending empty object')
    }

    const workflowId = route.query.id as string || 'default'
    const data = await $fetch<any>(`/api/workflows/${workflowId}/test-node`, {
      method: 'POST',
      headers: getHeaders(),
      body: {
        node: selectedNode.value,
        inputs: parsedInput
      }
    })

    nodeTestResult.value = data.result
    selectedNode.value.data.status = data.result.status
    selectedNode.value.data.durationMs = data.result.durationMs
    selectedNode.value.data.output = data.result.output
  } catch (err: any) {
    nodeTestResult.value = { status: 'failed', message: err?.data?.message || err?.message || 'Node execution failed' }
    selectedNode.value.data.status = 'failed'
  } finally {
    isTestingNode.value = false
  }
}

onPaneReady(() => {
  fitView({ padding: 0.5 })
})
</script>

<template>
  <UDashboardPanel id="workflow-studio" class="relative min-h-0 flex-1 h-full w-full bg-background" :ui="{ body: 'p-0 sm:p-0 overscroll-none' }">
    <template #header>
      <Navbar>
        <template #title>
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-workflow" class="size-5 text-primary" />
            <div>
              <h1 class="font-semibold text-foreground leading-tight">Workflow Studio</h1>
              <p class="text-xs text-muted">Client Onboarding & Automation Pipeline</p>
            </div>
          </div>
        </template>
        <div class="flex items-center gap-1.5 sm:gap-2">
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-blocks"
            size="sm"
            to="/integrations"
            title="Integrations"
          >
            <span class="hidden md:inline">Integrations</span>
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-activity"
            size="sm"
            @click="isLogsPanelOpen = true"
            title="Execution Logs"
          >
            <span class="hidden md:inline">Execution Logs</span>
          </UButton>
          <div class="w-px h-4 bg-default mx-0.5"></div>
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-play"
            size="sm"
            @click="openTestPayloadModal"
            title="Test Run"
          >
            <span class="hidden sm:inline">Test Run</span>
          </UButton>
          <div class="flex items-center gap-1 text-xs text-muted mr-1">
            <UIcon v-if="saveStatus === 'saving'" name="i-lucide-refresh-cw" class="animate-spin size-3" />
            <UIcon v-else-if="saveStatus === 'saved'" name="i-lucide-check" class="size-3 text-emerald-500" />
            <UIcon v-else name="i-lucide-alert-circle" class="size-3 text-red-500" />
            <span class="hidden lg:inline">{{ saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error saving' }}</span>
          </div>
          <UButton
            :color="workflowStatus === 'active' ? 'emerald' : 'primary'"
            :icon="workflowStatus === 'active' ? 'i-lucide-check-circle' : 'i-lucide-rocket'"
            :label="workflowStatus === 'active' ? 'Active' : 'Deploy'"
            size="sm"
            @click="deployWorkflow"
          />
        </div>
      </Navbar>
    </template>

    <div class="flex h-full relative overflow-hidden">
      <!-- Left Node Palette Mobile Backdrop -->
      <div 
        v-if="isPaletteOpen"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
        @click="isPaletteOpen = false"
      />
      <!-- Left Node Palette (Sidebar) -->
      <div
        v-show="isPaletteOpen"
        class="absolute inset-y-0 left-0 z-50 lg:relative lg:z-auto h-full shadow-2xl lg:shadow-none"
      >
        <NodePalette 
          @add-node="handleAddNode" 
          @close="isPaletteOpen = false"
        />
      </div>
      
      <!-- Canvas Area -->
      <div class="flex-1 h-full relative min-w-0" :class="{ 'lg:mr-96': isPropertiesPanelOpen }">
        
          <!-- Toolbar -->
          <div class="absolute top-3 left-3 z-10 flex items-center gap-1 sm:gap-2 bg-elevated/95 backdrop-blur-sm p-1 sm:p-1.5 rounded-xl border border-default shadow-sm max-w-[calc(100vw-6rem)] overflow-x-auto no-scrollbar">
            <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-sidebar"
            size="xs"
            @click="isPaletteOpen = !isPaletteOpen"
            title="Toggle Node Palette"
          />
                    <div class="w-px h-4 bg-default"></div>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-sparkles"
            size="xs"
            @click="isCopilotOpen = !isCopilotOpen"
            title="AI Copilot"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-layout-dashboard"
            size="xs"
            @click="layoutGraph"
            title="Auto-Layout Graph"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-undo-2"
            size="xs"
            :disabled="!canUndo"
            title="Undo"
            @click="undo"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-redo-2"
            size="xs"
            :disabled="!canRedo"
            title="Redo"
            @click="redo"
          />
          <div class="w-px h-4 bg-default"></div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-trash-2"
            size="xs"
            @click="removeNodes(nodes.filter(n => n.selected)); removeEdges(edges.filter(e => e.selected))"
            title="Delete Selected Elements"
          />
        </div>

        <div v-if="!isPropertiesPanelOpen" class="absolute top-3 right-3 z-10">
          <UButton
            color="neutral"
            variant="solid"
            icon="i-lucide-panel-right-open"
            size="xs"
            class="shadow-sm"
            @click="isPropertiesPanelOpen = true"
            label="Config"
          />
        </div>
        
        <VueFlow
          class="w-full h-full"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :default-zoom="1"
          :min-zoom="0.2"
          :max-zoom="4"
          @node-click="onNodeClick"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <Background pattern-color="var(--ui-border-accented)" :gap="24" :size="1" />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" />

          <!-- Logic Node Template -->
          <template #node-logic="{ data }">
            <div 
              class="bg-elevated border rounded-xl p-3.5 min-w-[220px] transition-colors group cursor-pointer"
              :class="data.status === 'completed' ? 'border-emerald-500/50 ring-1 ring-emerald-500/10' : (data.status === 'running' ? 'border-primary ring-1 ring-primary/20 animate-pulse' : 'border-default hover:border-primary/40')"
            >
              <div class="flex items-center justify-between mb-2 pb-2 border-b border-default/50">
                <span class="text-[9px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1">
                  <UIcon name="i-lucide-git-branch" class="size-3" /> Logic
                </span>
                <div v-if="data.status === 'completed' || data.durationMs" class="flex items-center gap-1 text-[9px] font-mono text-muted">
                  <UIcon v-if="data.status === 'completed'" name="i-lucide-check" class="size-3 text-emerald-500" />
                  <span v-if="data.durationMs">{{ data.durationMs }}ms</span>
                </div>
              </div>
              <Handle type="target" :position="Position.Left" class="!bg-default !w-2.5 !h-2.5" />
              <div class="flex items-center gap-2.5">
                <UIcon :name="data.icon || 'i-lucide-split'" class="size-4 text-foreground opacity-80 shrink-0" />
                <div class="min-w-0">
                  <h4 class="font-medium text-xs text-foreground truncate">{{ data.title }}</h4>
                  <p class="text-[10px] text-muted truncate">{{ data.subtitle }}</p>
                </div>
              </div>
              
              <!-- Conditional Handles based on logic type -->
              <template v-if="data.subtype === 'if-else'">
                <Handle type="source" :position="Position.Right" id="true" class="!bg-emerald-500 !w-2.5 !h-2.5 !top-1/3" />
                <div class="absolute -right-6 top-1/3 -translate-y-1/2 text-[9px] font-bold text-emerald-500">TRUE</div>
                <Handle type="source" :position="Position.Right" id="false" class="!bg-red-500 !w-2.5 !h-2.5 !top-2/3" />
                <div class="absolute -right-7 top-2/3 -translate-y-1/2 text-[9px] font-bold text-red-500">FALSE</div>
              </template>
              <template v-else>
                <Handle type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5" />
              </template>
            </div>
          </template>

          <!-- Trigger Node Template -->
          <template #node-trigger="{ data }">
            <div 
              class="bg-elevated border rounded-xl p-3.5 min-w-[220px] transition-colors group cursor-pointer"
              :class="data.status === 'completed' ? 'border-emerald-500/50 ring-1 ring-emerald-500/10' : (data.status === 'running' ? 'border-primary ring-1 ring-primary/20 animate-pulse' : 'border-default hover:border-primary/40')"
            >
              <div class="flex items-center justify-between mb-2 pb-2 border-b border-default/50">
                <span class="text-[9px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1">
                  <UIcon name="i-lucide-zap" class="size-3" /> Trigger
                </span>
                <div v-if="data.status === 'completed' || data.durationMs" class="flex items-center gap-1 text-[9px] font-mono text-muted">
                  <UIcon v-if="data.status === 'completed'" name="i-lucide-check" class="size-3 text-emerald-500" />
                  <span v-if="data.durationMs">{{ data.durationMs }}ms</span>
                </div>
              </div>
              <div class="flex items-center gap-2.5">
                <UIcon :name="data.icon || 'i-lucide-mail'" class="size-4 text-foreground opacity-80 shrink-0" />
                <div class="min-w-0">
                  <h4 class="font-medium text-xs text-foreground truncate">{{ data.title }}</h4>
                  <p class="text-[10px] text-muted truncate">{{ data.subtitle }}</p>
                </div>
              </div>
              <Handle type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5" />
            </div>
          </template>

          <!-- AI Agent Node Template -->
          <template #node-agent="{ data }">
            <div 
              class="bg-elevated border rounded-xl p-3.5 min-w-[220px] transition-colors group cursor-pointer"
              :class="data.status === 'completed' ? 'border-emerald-500/50 ring-1 ring-emerald-500/10' : (data.status === 'running' ? 'border-primary ring-1 ring-primary/20 animate-pulse' : 'border-default hover:border-primary/40')"
            >
              <div class="flex items-center justify-between mb-2 pb-2 border-b border-default/50">
                <span class="text-[9px] font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                  <UIcon name="i-lucide-sparkles" class="size-3" /> AI Agent
                </span>
                <div v-if="data.status === 'completed' || data.durationMs" class="flex items-center gap-1 text-[9px] font-mono text-muted">
                  <UIcon v-if="data.status === 'completed'" name="i-lucide-check" class="size-3 text-emerald-500" />
                  <span v-if="data.durationMs">{{ data.durationMs }}ms</span>
                </div>
              </div>
              <Handle type="target" :position="Position.Left" class="!bg-default !w-2.5 !h-2.5" />
              <div class="flex items-center gap-2.5">
                <UIcon :name="data.icon || 'i-lucide-brain'" class="size-4 shrink-0 transition-colors" :class="[data.color, 'opacity-80']" />
                <div class="min-w-0">
                  <h4 class="font-medium text-xs text-foreground truncate">{{ data.title }}</h4>
                  <p class="text-[10px] text-muted truncate">{{ data.subtitle }}</p>
                </div>
              </div>
              <Handle type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5" />
            </div>
          </template>

          <!-- Action Node Template -->
          <template #node-action="{ data }">
            <div 
              class="bg-elevated border rounded-xl p-3.5 min-w-[220px] transition-colors group cursor-pointer"
              :class="data.status === 'completed' ? 'border-emerald-500/50 ring-1 ring-emerald-500/10' : (data.status === 'auth_required' ? 'border-amber-500/50 ring-1 ring-amber-500/10' : (data.status === 'running' ? 'border-primary ring-1 ring-primary/20 animate-pulse' : 'border-default hover:border-primary/40'))"
            >
              <div class="flex items-center justify-between mb-2 pb-2 border-b border-default/50">
                <span class="text-[9px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1">
                  <UIcon name="i-lucide-layers" class="size-3" /> Action
                </span>
                <div v-if="data.status === 'completed' || data.status === 'auth_required' || data.durationMs" class="flex items-center gap-1 text-[9px] font-mono text-muted">
                  <UIcon v-if="data.status === 'completed'" name="i-lucide-check" class="size-3 text-emerald-500" />
                  <UIcon v-else-if="data.status === 'auth_required'" name="i-lucide-alert-triangle" class="size-3 text-amber-500" />
                  <span v-if="data.durationMs">{{ data.durationMs }}ms</span>
                </div>
              </div>
              <Handle type="target" :position="Position.Left" class="!bg-default !w-2.5 !h-2.5" />
              <div class="flex items-center gap-2.5">
                <UIcon :name="data.icon || 'i-lucide-zap'" class="size-4 text-foreground opacity-80 shrink-0" />
                <div class="min-w-0">
                  <h4 class="font-medium text-xs text-foreground truncate">{{ data.title }}</h4>
                  <p class="text-[10px] text-muted truncate">{{ data.subtitle }}</p>
                </div>
              </div>
              <Handle type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5" />
            </div>
          </template>
        </VueFlow>

        <!-- Mobile Floating Quick Dock -->
        <div class="lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-elevated/95 backdrop-blur-md px-3 py-1.5 rounded-full border border-default shadow-xl">
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-plus"
            size="xs"
            label="Node"
            @click="isPaletteOpen = true"
          />
          <div class="w-px h-3.5 bg-default"></div>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-sparkles"
            size="xs"
            title="AI Copilot"
            @click="isCopilotOpen = true"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-play"
            size="xs"
            title="Test Run"
            @click="openTestPayloadModal"
          />
          <UButton
            v-if="selectedNode"
            color="neutral"
            variant="subtle"
            icon="i-lucide-sliders"
            size="xs"
            label="Config"
            @click="isPropertiesPanelOpen = true"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-maximize-2"
            size="xs"
            title="Fit View"
            @click="() => fitView({ padding: 0.2 })"
          />
        </div>
      </div>

      <!-- AI Copilot Backdrop on mobile -->
      <div 
        v-if="isCopilotOpen" 
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
        @click="isCopilotOpen = false"
      />
      <!-- AI Copilot Drawer -->
      <div 
        v-if="isCopilotOpen" 
        class="w-[85vw] sm:w-80 md:w-96 border-l border-default bg-elevated h-full flex flex-col shrink-0 z-50 absolute right-0 top-0 bottom-0 shadow-2xl"
        :class="{ 'lg:right-96': isPropertiesPanelOpen }"
      >
        <div class="p-4 border-b border-default flex items-center justify-between bg-primary/5">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-sparkles" class="size-4" />
            <h3 class="font-semibold text-sm">AI Copilot</h3>
          </div>
          <UButton 
            color="neutral" 
            variant="ghost" 
            icon="i-lucide-x" 
            size="xs" 
            @click="isCopilotOpen = false" 
          />
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          <div v-for="(msg, i) in copilotChat" :key="i" class="flex flex-col gap-1" :class="msg.role === 'user' ? 'items-end' : 'items-start'">
            <div 
              class="px-3 py-2 rounded-xl max-w-[90%]"
              :class="msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/10 text-foreground border border-default'"
            >
              {{ msg.text }}
            </div>
          </div>
          <div v-if="isCopilotLoading" class="flex items-start gap-1">
            <div class="px-3 py-2 rounded-xl bg-muted/10 text-foreground border border-default">
              <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-primary" />
            </div>
          </div>
        </div>

        <div class="p-3 border-t border-default bg-background">
          <UInput
            v-model="copilotPrompt"
            placeholder="E.g. Add a slack alert node"
            size="sm"
            @keyup.enter="runCopilot"
            :disabled="isCopilotLoading"
            class="w-full"
          >
            <template #trailing>
              <UButton
                color="primary"
                variant="ghost"
                icon="i-lucide-send"
                size="xs"
                :loading="isCopilotLoading"
                @click="runCopilot"
              />
            </template>
          </UInput>
        </div>
      </div>

      <!-- Properties Panel Mobile Backdrop -->
      <div 
        v-if="isPropertiesPanelOpen" 
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
        @click="isPropertiesPanelOpen = false"
      />
      <!-- Properties Panel (Right Drawer) -->
      <div 
        v-if="isPropertiesPanelOpen" 
        class="w-[85vw] sm:w-96 border-l border-default bg-elevated h-full flex flex-col shrink-0 z-50 absolute right-0 top-0 bottom-0 shadow-2xl lg:shadow-none"
      >
        <div class="p-4 border-b border-default flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-sliders" class="size-4 text-muted" />
            <span class="font-semibold text-sm text-foreground">Node Configuration</span>
          </div>
          <UButton 
            color="neutral" 
            variant="ghost" 
            icon="i-lucide-x" 
            size="xs" 
            @click="isPropertiesPanelOpen = false" 
          />
        </div>

        <div v-if="selectedNode" class="p-4 flex-1 overflow-y-auto space-y-4">
          <!-- Node Title & Type -->
          <div class="flex items-center gap-3 p-3 bg-background border border-default rounded-lg">
            <div class="p-2 bg-elevated rounded-md border border-default">
              <UIcon :name="selectedNode.data.icon || 'i-lucide-box'" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold text-foreground text-sm truncate">{{ selectedNode.data.title }}</h3>
              <p class="text-xs text-muted uppercase tracking-wider">{{ selectedNode.type }} Node</p>
            </div>
          </div>

          <!-- Tabs -->
          <div class="flex items-center gap-2 border-b border-default mb-4">
            <button 
              class="px-3 py-1.5 text-xs font-medium border-b-2 transition-colors"
              :class="activePropertiesTab === 'config' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'"
              @click="activePropertiesTab = 'config'"
            >
              Configuration
            </button>
            <button 
              class="px-3 py-1.5 text-xs font-medium border-b-2 transition-colors"
              :class="activePropertiesTab === 'test' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'"
              @click="activePropertiesTab = 'test'"
            >
              Test Step
            </button>
          </div>

          <!-- Configuration Tab -->
          <div v-if="activePropertiesTab === 'config'" class="space-y-4">
            <!-- Trigger Node Configuration -->
            <template v-if="selectedNode.type === 'trigger'">
              <div class="space-y-3" v-if="selectedNode.data.subtype !== 'webhook'">
                <div>
                  <label class="text-xs font-medium text-foreground block mb-1">Trigger Service</label>
                  <div class="flex items-center gap-2 p-2 rounded-md border border-default bg-background text-sm">
                    <UIcon name="i-logos-google-gmail" class="size-4 shrink-0" />
                    <span class="font-medium text-foreground">Gmail</span>
                    <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Connected</span>
                  </div>
                </div>

                <div>
                  <label class="text-xs font-medium text-foreground block mb-1">Account</label>
                  <div class="p-2 rounded-md border border-default bg-background text-xs font-mono text-muted truncate">
                    {{ selectedNode.data.connection || 'Not connected' }}
                  </div>
                </div>

                <div>
                  <label class="text-xs font-medium text-foreground block mb-1">Event</label>
                  <USelect
                    :options="[{ label: 'New Email Received', value: 'new_email' }, { label: 'Important Email Received', value: 'important_email' }]"
                    v-model="selectedNode.data.event"
                    @change="onNodeDataChange"
                    size="md"
                    class="w-full"
                  />
                </div>
              </div>
              <div class="space-y-3" v-else>
                <div>
                  <label class="text-xs font-medium text-foreground block mb-1">Webhook URL</label>
                  <div class="flex items-center gap-2">
                    <UInput
                      :model-value="webhookUrl"
                      readonly
                      size="sm"
                      class="flex-1 font-mono text-[10px]"
                    />
                    <UButton
                      :color="copied ? 'emerald' : 'neutral'"
                      variant="soft"
                      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                      size="sm"
                      :title="copied ? 'Copied!' : 'Copy URL'"
                      @click="copyWebhook"
                    />
                  </div>
                  <p class="text-[10px] text-muted mt-1">Send a POST request to this URL to trigger this workflow.</p>
                </div>
              </div>
            </template>

          <!-- Agent Node Configuration -->
          <template v-if="selectedNode.type === 'agent'">
            <div class="space-y-3">
              <div>
                <label class="text-xs font-medium text-foreground block mb-1">AI Engine Model</label>
                <USelect
                  :options="models"
                  v-model="selectedNode.data.model"
                  @change="onNodeDataChange"
                  size="md"
                  class="w-full"
                />
              </div>

              <div>
                <label class="text-xs font-medium text-foreground block mb-1">System Instructions</label>
                <VariableTextarea
                  v-model="selectedNode.data.prompt"
                  :variables="dynamicVariables"
                  placeholder="You are an intelligent workflow automation agent..."
                  :rows="5"
                />
              </div>

              <div>
                <label class="text-xs font-medium text-foreground block mb-1">Context Pipeline Inputs</label>
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between p-2 bg-background border border-default rounded-md text-xs">
                    <span class="font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[11px]">{{ '{' }}{{ 'trigger.email.body' }}{{ '}' }}</span>
                    <span class="text-muted text-[11px]">Email Body</span>
                  </div>
                  <div class="flex items-center justify-between p-2 bg-background border border-default rounded-md text-xs">
                    <span class="font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[11px]">{{ '{' }}{{ 'trigger.email.sender' }}{{ '}' }}</span>
                    <span class="text-muted text-[11px]">Sender</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Logic Node Configuration -->
          <template v-if="selectedNode.type === 'logic'">
            <div class="space-y-3">
              <div v-if="selectedNode.id.startsWith('logic-if') || selectedNode.data.title.includes('If')">
                <label class="text-xs font-medium text-foreground block mb-1">Condition Expression</label>
                <VariablePicker
                  v-model="selectedNode.data.condition"
                  :variables="dynamicVariables"
                  placeholder="e.g. {{trigger.email.subject}} == 'Urgent'"
                />
              </div>
              <div v-else-if="selectedNode.id.startsWith('logic-switch') || selectedNode.data.title.includes('Switch')">
                <label class="text-xs font-medium text-foreground block mb-1">Switch Variable</label>
                <VariablePicker
                  v-model="selectedNode.data.switchVar"
                  :variables="dynamicVariables"
                  placeholder="e.g. {{ai-triage.result}}"
                />
              </div>
              <div v-else-if="selectedNode.id.startsWith('logic-code') || selectedNode.data.title.includes('JavaScript')">
                <label class="text-xs font-medium text-foreground block mb-1">Code snippet (JavaScript)</label>
                <VariableTextarea
                  v-model="selectedNode.data.code"
                  :variables="dynamicVariables"
                  placeholder="return { formattedDate: new Date().toISOString() };"
                  :rows="6"
                />
              </div>
            </div>
          </template>

          <!-- Action Node Configuration -->
          <template v-if="selectedNode.type === 'action'">
            <div class="space-y-3">
              <div>
                <label class="text-xs font-medium text-foreground block mb-1">Target Service</label>
                <div class="space-y-2">
                  <select
                    v-model="selectedNode.data.provider"
                    class="w-full text-sm rounded-md border border-default bg-background p-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    @change="handleProviderChange(($event.target as HTMLSelectElement).value)"
                  >
                    <optgroup label="Google Workspace (Native)">
                      <option value="google_drive">Google Drive</option>
                      <option value="gmail">Gmail</option>
                      <option value="google_calendar">Google Calendar</option>
                      <option value="google_docs">Google Docs</option>
                      <option value="google_sheets">Google Sheets</option>
                    </optgroup>
                    <optgroup label="Third-Party Services">
                      <option value="slack">Slack</option>
                      <option value="discord">Discord</option>
                      <option value="notion">Notion</option>
                      <option value="linear">Linear</option>
                      <option value="jira">Jira</option>
                      <option value="github">GitHub</option>
                      <option value="trello">Trello</option>
                      <option value="asana">Asana</option>
                      <option value="clickup">ClickUp</option>
                      <option value="hubspot">HubSpot</option>
                    </optgroup>
                  </select>
                </div>
              </div>

              <!-- Connection Status & Action -->
              <div>
                <label class="text-xs font-medium text-foreground block mb-1">Connection State</label>
                <div class="p-3 rounded-lg border border-default bg-background flex items-center justify-between">
                  <div class="min-w-0 pr-2">
                    <div class="flex items-center gap-2">
                      <span 
                        class="size-2 rounded-full" 
                        :class="selectedIntegration?.status === 'connected' ? 'bg-emerald-500' : 'bg-neutral-400'"
                      />
                      <span class="text-xs font-medium text-foreground">
                        {{ selectedIntegration?.status === 'connected' ? 'Connected' : 'Not Connected' }}
                      </span>
                    </div>
                    <p class="text-[11px] text-muted truncate mt-0.5">
                      {{ selectedIntegration?.status === 'connected' ? selectedIntegration.account : 'Authorization required' }}
                    </p>
                  </div>

                  <UButton
                    v-if="selectedIntegration?.status !== 'connected'"
                    label="Connect"
                    color="primary"
                    size="xs"
                    @click="connectSelectedProvider(selectedNode.data.provider)"
                  />
                </div>
              </div>

              <!-- Action Parameters -->
              <div v-if="selectedNode.data.provider === 'slack'">
                <label class="text-xs font-medium text-foreground block mb-1">Slack Channel</label>
                <UInput v-model="selectedNode.data.channel" placeholder="#client-alerts" size="sm" class="w-full" />
              </div>

              <div v-else-if="selectedNode.data.provider === 'google_drive'">
                <label class="text-xs font-medium text-foreground block mb-1">Drive Folder</label>
                <UInput v-model="selectedNode.data.folder" placeholder="/Client Proposals" size="sm" class="w-full" />
              </div>
            </div>
          </template>
          </div> <!-- Close configuration tab -->

          <!-- Test Step Tab -->
          <div v-if="activePropertiesTab === 'test'" class="space-y-4">
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-medium text-foreground">Mock Input Data (JSON)</label>
                <UButton
                  label="Test this step"
                  color="primary"
                  size="xs"
                  :loading="isTestingNode"
                  @click="runTestNode"
                />
              </div>
              <p class="text-[10px] text-muted">Provide mock data to simulate inputs from upstream nodes.</p>
              <UTextarea
                v-model="nodeTestInput"
                class="font-mono text-xs w-full"
                :rows="8"
                placeholder='{\n  "trigger": { "email": { "subject": "test" } }\n}'
              />
            </div>

            <div v-if="nodeTestResult" class="space-y-2 mt-4 pt-4 border-t border-default">
              <div class="flex items-center justify-between">
                <label class="text-xs font-medium text-foreground">Execution Result</label>
                <span class="text-[10px] px-2 py-0.5 rounded-full"
                  :class="nodeTestResult.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'">
                  {{ nodeTestResult.status === 'completed' ? 'Success' : 'Failed' }} ({{ nodeTestResult.durationMs }}ms)
                </span>
              </div>
              <pre class="bg-background border border-default p-2 rounded-md text-[10px] font-mono overflow-auto max-h-64">{{ JSON.stringify(nodeTestResult.output, null, 2) }}</pre>
              <div v-if="nodeTestResult.message" class="text-xs mt-2" :class="nodeTestResult.status === 'completed' ? 'text-emerald-500' : 'text-red-500'">
                {{ nodeTestResult.message }}
              </div>
              <div v-if="nodeTestResult.authUrl" class="mt-2">
                <UButton
                  color="amber"
                  variant="soft"
                  size="xs"
                  label="Authenticate Provider"
                  :to="nodeTestResult.authUrl"
                  target="_blank"
                />
              </div>
            </div>
            
            <div v-else-if="selectedNode.data.output" class="space-y-2 mt-4 pt-4 border-t border-default">
              <div class="flex items-center justify-between">
                <label class="text-xs font-medium text-foreground">Previous Run Output</label>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">
                  Success ({{ selectedNode.data.durationMs }}ms)
                </span>
              </div>
              <pre class="bg-background border border-default p-2 rounded-md text-[10px] font-mono overflow-auto max-h-64">{{ JSON.stringify(selectedNode.data.output, null, 2) }}</pre>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Test Payload Configuration Modal -->
    <UModal
      v-model:open="isTestPayloadModalOpen"
      title="Configure Test Run Payload"
      description="Provide the JSON payload that will be passed to the trigger node."
    >
      <template #body>
        <div class="space-y-4">
          <UTextarea
            v-model="testPayload"
            class="font-mono text-xs w-full"
            :rows="12"
            placeholder='{ "mock_data": "value" }'
          />
        </div>
      </template>

      <template #footer>
        <div class="flex items-center justify-end w-full gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" size="sm" @click="isTestPayloadModalOpen = false" />
          <UButton label="Execute Test Run" color="primary" size="sm" icon="i-lucide-play" :loading="isExecuting" @click="runTestWorkflow" />
        </div>
      </template>
    </UModal>

    <!-- Test Run Execution Drawer -->
    <UModal
      v-model:open="isTestRunDrawerOpen"
      title="Workflow Test Run Execution"
      description="Live execution logs, input payloads, and step output verification."
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <!-- Overall Status Banner -->
          <div 
            v-if="isExecuting"
            class="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-3 text-sm text-foreground"
          >
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-primary shrink-0" />
            <span>Executing workflow pipeline through AI and integration dispatchers...</span>
          </div>

          <div 
            v-else-if="executionResult"
            class="p-3 rounded-lg flex items-center justify-between text-sm"
            :class="executionResult.status === 'completed' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300'"
          >
            <div class="flex items-center gap-2">
              <UIcon :name="executionResult.status === 'completed' ? 'i-lucide-check-circle-2' : 'i-lucide-alert-circle'" class="size-5 shrink-0" />
              <span class="font-medium">Workflow Run {{ executionResult.status === 'completed' ? 'Completed Successfully' : 'Completed with Notes' }}</span>
            </div>
            <span class="text-xs font-mono">{{ executionResult.durationMs }}ms</span>
          </div>

          <!-- Step Logs Timeline -->
          <div v-if="executionResult?.logs?.length" class="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
            <div 
              v-for="log in executionResult.logs"
              :key="log.nodeId"
              class="p-3 rounded-lg border border-default bg-neutral-50/50 dark:bg-neutral-900/50 flex flex-col gap-2 text-xs"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UIcon 
                    :name="log.status === 'completed' ? 'i-lucide-check' : (log.status === 'auth_required' ? 'i-lucide-key' : 'i-lucide-x')"
                    class="size-3.5"
                    :class="log.status === 'completed' ? 'text-emerald-500' : (log.status === 'auth_required' ? 'text-amber-500' : 'text-red-500')"
                  />
                  <span class="font-semibold text-foreground">{{ log.nodeTitle }}</span>
                  <span class="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-neutral-200 dark:bg-neutral-800 text-muted">
                    {{ log.type }}
                  </span>
                </div>
                <span class="font-mono text-muted text-[11px]">{{ log.durationMs }}ms</span>
              </div>

              <p class="text-muted text-[11px]">{{ log.message }}</p>

              <!-- Auth required banner with button -->
              <div 
                v-if="log.status === 'auth_required'"
                class="p-2 rounded bg-amber-500/10 border border-amber-500/20 flex items-center justify-between"
              >
                <span class="text-amber-700 dark:text-amber-300 font-medium">Authentication required to complete this step</span>
                <UButton
                  v-if="log.authUrl"
                  label="Authorize Account"
                  color="warning"
                  size="xs"
                  :to="log.authUrl"
                  target="_blank"
                />
              </div>

              <!-- Output snippet -->
              <div v-if="log.output" class="bg-background rounded p-2 border border-default font-mono text-[10px] text-muted overflow-x-auto max-h-24">
                <pre>{{ JSON.stringify(log.output, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex items-center justify-between w-full">
          <span class="text-xs text-muted">All steps are traced and persisted in run logs.</span>
          <UButton label="Close" color="neutral" variant="subtle" size="sm" @click="isTestRunDrawerOpen = false" />
        </div>
      </template>
    </UModal>
    <!-- Execution Logs Drawer -->
    <USlideover
      v-model:open="isLogsPanelOpen"
      title="Execution History"
      description="View past runs, webhooks, and execution metrics for this workflow."
    >
      <template #body>
        <div class="h-full flex flex-col">
          <div v-if="isLoadingRuns" class="flex items-center justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="size-6 text-muted animate-spin" />
          </div>
          
          <div v-else-if="workflowRuns.length === 0" class="text-center py-12">
            <UIcon name="i-lucide-activity" class="size-10 text-muted/50 mx-auto mb-3" />
            <h3 class="text-sm font-medium text-foreground">No execution history</h3>
            <p class="text-xs text-muted mt-1">Deploy and trigger this workflow to see logs here.</p>
          </div>

          <div v-else class="space-y-4 overflow-y-auto pr-2">
            <div 
              v-for="run in workflowRuns" 
              :key="run.id"
              class="border border-default bg-elevated rounded-lg p-4 cursor-pointer hover:border-primary/50 transition-colors group"
            >
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <span class="size-2 rounded-full" :class="run.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'" />
                  <span class="text-sm font-semibold text-foreground">
                    {{ run.status === 'completed' ? 'Success' : 'Failed' }}
                  </span>
                </div>
                <span class="text-xs text-muted">{{ new Date(run.createdAt).toLocaleString() }}</span>
              </div>
              
              <div class="flex items-center justify-between text-xs text-muted mb-4 pb-4 border-b border-default">
                <span>Duration: <span class="font-mono text-foreground">{{ run.durationMs }}ms</span></span>
                <span>ID: <span class="font-mono text-foreground">{{ run.id.slice(-6) }}</span></span>
              </div>

              <!-- Simplified log view inside history card -->
              <div class="space-y-2">
                <div v-for="log in (run.logs || []).slice(0, 3)" :key="log.nodeId" class="flex items-center gap-2 text-xs">
                  <UIcon 
                    :name="log.status === 'completed' ? 'i-lucide-check-circle-2' : (log.status === 'failed' ? 'i-lucide-x-circle' : 'i-lucide-alert-circle')"
                    class="size-3"
                    :class="log.status === 'completed' ? 'text-emerald-500' : (log.status === 'failed' ? 'text-red-500' : 'text-amber-500')"
                  />
                  <span class="font-medium text-foreground truncate w-24">{{ log.nodeTitle }}</span>
                  <span class="text-muted truncate flex-1">{{ log.message }}</span>
                  <span class="font-mono text-[9px] text-muted">{{ log.durationMs }}ms</span>
                </div>
                <div v-if="(run.logs?.length || 0) > 3" class="text-xs text-primary font-medium pl-5 pt-1">
                  + {{ run.logs.length - 3 }} more steps
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </USlideover>
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
  border: 1px solid var(--ui-border-default);
  border-radius: 0.5rem;
  overflow: hidden;
}
.vue-flow__minimap-mask {
  fill: var(--ui-bg-background);
  opacity: 0.6;
}
.vue-flow__minimap-node {
  fill: var(--ui-primary);
  opacity: 0.5;
}
.vue-flow__controls {
  background-color: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border-default);
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
.vue-flow__controls-button {
  background-color: transparent;
  border-bottom: 1px solid var(--ui-border-default);
  color: var(--ui-text-foreground);
  transition: background-color 0.15s ease;
}
.vue-flow__controls-button:hover {
  background-color: var(--ui-bg-accented);
}
.vue-flow__controls-button:last-child {
  border-bottom: none;
}
</style>
