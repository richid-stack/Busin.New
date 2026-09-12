<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { Handle, Position } from '@vue-flow/core'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import Navbar from '../../components/Navbar.vue'
import { useIntegrationsModal } from '../../composables/useIntegrationsModal'
import { useModels } from '../../composables/useModels'
import { useRoute } from 'vue-router'
import { useCsrf } from '../../composables/useCsrf'

const { onPaneReady, fitView } = useVueFlow()
const { csrf, headerName } = useCsrf()
const { openIntegrationsModal } = useIntegrationsModal()
const { models } = useModels()
const route = useRoute()

const nodes = ref<any[]>([])

const edges = ref([
  { 
    id: 'e-trigger-triage', 
    source: 'trigger', 
    target: 'ai-triage', 
    animated: true, 
    style: { stroke: 'var(--ui-primary)', strokeWidth: 2 } 
  },
  { 
    id: 'e-triage-writer', 
    source: 'ai-triage', 
    target: 'ai-writer', 
    animated: true, 
    style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 }
  },
  { 
    id: 'e-triage-scheduler', 
    source: 'ai-triage', 
    target: 'ai-scheduler', 
    animated: true, 
    style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 } 
  },
  { 
    id: 'e-writer-docs', 
    source: 'ai-writer', 
    target: 'action-docs', 
    animated: true, 
    style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 } 
  },
  { 
    id: 'e-scheduler-slack', 
    source: 'ai-scheduler', 
    target: 'action-slack', 
    animated: true, 
    style: { stroke: 'var(--ui-border-accented)', strokeWidth: 2 } 
  }
])

const isPropertiesPanelOpen = ref(true)
const selectedNode = ref<any>(nodes.value[1])
const isTestRunDrawerOpen = ref(false)
const isExecuting = ref(false)
const executionResult = ref<any>(null)
const executionError = ref<string | null>(null)
const userIntegrations = ref<any[]>([])

async function loadIntegrations() {
  try {
    const res = await fetch('/api/integrations')
    if (res.ok) {
      userIntegrations.value = await res.json()
    }
  } catch (e) {
    console.error('Failed to load user integrations:', e)
  }
}

onMounted(async () => {
  if (window.opener && window.name !== '') {
    window.opener.postMessage({ type: 'COMPOSIO_AUTH_SUCCESS' }, '*')
    window.close()
    return
  }
  loadIntegrations()
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'COMPOSIO_AUTH_SUCCESS') {
      loadIntegrations()
    }
  })

  const workflowId = route.query.id as string
  try {
    let workflow = null
    if (workflowId) {
      const res = await fetch(`/api/workflows/${workflowId}`)
      if (res.ok) workflow = await res.json()
    }
    if (!workflow) {
      const resList = await fetch('/api/workflows')
      if (resList.ok) {
        const list = await resList.json()
        if (list && list.length > 0) workflow = list[0]
      }
    }
    if (workflow) {
      nodes.value = workflow.nodes || []
      edges.value = workflow.edges || []
      setTimeout(() => {
        fitView({ padding: 0.2, includeHiddenNodes: true })
      }, 100)
    }
  } catch (err) {
    console.error('Failed to load workflow:', err)
  }
})

const { updateNodeData } = useVueFlow()
const onNodeDataChange = () => {
  if (selectedNode.value) {
    updateNodeData(selectedNode.value.id, { ...selectedNode.value.data })
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
    const res = await fetch('/api/integrations/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [headerName]: csrf()
      },
      body: JSON.stringify({
        provider,
        callbackUrl: window.location.origin + '/workflows'
      })
    })
    const data = await res.json()
    if (data.redirectUrl) {
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

async function runTestWorkflow() {
  isExecuting.value = true
  executionError.value = null
  executionResult.value = null
  isTestRunDrawerOpen.value = true

  // Set visual running status on nodes
  nodes.value.forEach(n => {
    n.data.status = 'running'
  })

  try {
    const res = await fetch('/api/workflows/client-onboarding-pipeline/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [headerName]: csrf()
      },
      body: JSON.stringify({
        input: {
          email: {
            id: 'msg_98124',
            sender: 'sarah.connor@acme-corp.com',
            senderName: 'Sarah Connor',
            subject: 'Urgent: Enterprise Security Onboarding & Scope Proposal',
            date: new Date().toISOString(),
            body: 'Hi Team,\n\nWe would like to accelerate our enterprise onboarding kickoff for next Tuesday at 2:00 PM EST. Could you please prepare and share a custom PDF proposal detailing your multi-region cloud security guarantees, SLA tiers, and enterprise pricing?\n\nLooking forward to speaking with you.\n\nBest regards,\nSarah Connor\nVP Engineering, Acme Corp'
          }
        }
      })
    })

    if (!res.ok) {
      throw new Error(`Execution failed with status ${res.status}`)
    }

    const data = await res.json()
    executionResult.value = data

    // Update individual node statuses from logs
    if (data.logs && Array.isArray(data.logs)) {
      data.logs.forEach((logItem: any) => {
        const node = nodes.value.find(n => n.id === logItem.nodeId)
        if (node) {
          node.data.status = logItem.status
        }
      })
    }
  } catch (err: any) {
    executionError.value = err?.message || 'Workflow run failed'
    nodes.value.forEach(n => {
      if (n.data.status === 'running') {
        n.data.status = 'failed'
      }
    })
  } finally {
    isExecuting.value = false
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
        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-blocks"
            label="Integrations"
            size="sm"
            @click="openIntegrationsModal()"
          />
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-play"
            label="Test Run"
            size="sm"
            :loading="isExecuting"
            @click="runTestWorkflow"
          />
          <UButton
            color="primary"
            icon="i-lucide-rocket"
            label="Deploy Workflow"
            size="sm"
          />
        </div>
      </Navbar>
    </template>

    <div class="flex h-full relative overflow-hidden">
      <!-- Canvas Area -->
      <div class="flex-1 h-full relative" :class="{ 'mr-96': isPropertiesPanelOpen }">
        <div v-if="!isPropertiesPanelOpen" class="absolute top-4 right-4 z-10">
          <UButton
            color="neutral"
            variant="solid"
            icon="i-lucide-panel-right-open"
            size="sm"
            class="shadow-sm"
            @click="isPropertiesPanelOpen = true"
            label="Node Config"
          />
        </div>
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :default-zoom="1"
          :min-zoom="0.2"
          :max-zoom="4"
          @node-click="onNodeClick"
        >
          <Background pattern-color="var(--ui-border-accented)" :gap="24" :size="1" />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" />

          <!-- Trigger Node Template -->
          <template #node-trigger="{ data }">
            <div 
              class="bg-elevated border rounded-xl p-4 shadow-sm min-w-[240px] transition-all group relative cursor-pointer"
              :class="data.status === 'completed' ? 'border-emerald-500/60 ring-1 ring-emerald-500/20' : (data.status === 'running' ? 'border-primary ring-1 ring-primary/30 animate-pulse' : 'border-default hover:border-primary/50')"
            >
              <div class="absolute -top-3 left-4 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary/20 flex items-center gap-1">
                <span>Trigger</span>
                <UIcon v-if="data.status === 'completed'" name="i-lucide-check" class="size-3 text-emerald-500" />
              </div>
              <div class="flex items-center gap-3 mt-2">
                <div class="p-2.5 bg-background rounded-lg border border-default shadow-sm">
                  <UIcon :name="data.icon || 'i-lucide-mail'" class="size-5" />
                </div>
                <div>
                  <h4 class="font-medium text-sm text-foreground">{{ data.title }}</h4>
                  <p class="text-xs text-muted">{{ data.subtitle }}</p>
                </div>
              </div>
              <Handle type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5" />
            </div>
          </template>

          <!-- AI Agent Node Template -->
          <template #node-agent="{ data }">
            <div 
              class="bg-elevated border rounded-xl p-4 shadow-sm min-w-[240px] transition-all group relative cursor-pointer"
              :class="data.status === 'completed' ? 'border-emerald-500/60 ring-1 ring-emerald-500/20' : (data.status === 'running' ? 'border-primary ring-1 ring-primary/30 animate-pulse' : 'border-default hover:border-primary/50')"
            >
              <div class="absolute -top-3 left-4 bg-elevated text-foreground text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-default flex items-center gap-1">
                <UIcon name="i-lucide-sparkles" class="size-3 text-primary" />
                <span>AI Agent</span>
                <UIcon v-if="data.status === 'completed'" name="i-lucide-check" class="size-3 text-emerald-500" />
              </div>
              <Handle type="target" :position="Position.Left" class="!bg-default !w-2.5 !h-2.5" />
              <div class="flex items-center gap-3 mt-2">
                <div class="p-2.5 bg-background rounded-lg border border-default shadow-sm">
                  <UIcon :name="data.icon || 'i-lucide-brain'" class="size-5" :class="data.color" />
                </div>
                <div>
                  <h4 class="font-medium text-sm text-foreground">{{ data.title }}</h4>
                  <p class="text-xs text-muted">{{ data.subtitle }}</p>
                </div>
              </div>
              <Handle type="source" :position="Position.Right" class="!bg-primary !w-2.5 !h-2.5" />
            </div>
          </template>

          <!-- Action Node Template -->
          <template #node-action="{ data }">
            <div 
              class="bg-elevated border rounded-xl p-4 shadow-sm min-w-[240px] transition-all group relative cursor-pointer"
              :class="data.status === 'completed' ? 'border-emerald-500/60 ring-1 ring-emerald-500/20' : (data.status === 'auth_required' ? 'border-amber-500 ring-1 ring-amber-500/30' : (data.status === 'running' ? 'border-primary ring-1 ring-primary/30 animate-pulse' : 'border-default hover:border-primary/50'))"
            >
              <div class="absolute -top-3 left-4 bg-elevated text-foreground text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-default flex items-center gap-1">
                <span class="size-1.5 rounded-full bg-emerald-500" />
                <span>Action</span>
                <UIcon v-if="data.status === 'completed'" name="i-lucide-check" class="size-3 text-emerald-500" />
                <UIcon v-else-if="data.status === 'auth_required'" name="i-lucide-alert-triangle" class="size-3 text-amber-500" />
              </div>
              <Handle type="target" :position="Position.Left" class="!bg-default !w-2.5 !h-2.5" />
              <div class="flex items-center gap-3 mt-2">
                <div class="p-2.5 bg-background rounded-lg border border-default shadow-sm">
                  <UIcon :name="data.icon || 'i-lucide-zap'" class="size-5" />
                </div>
                <div>
                  <h4 class="font-medium text-sm text-foreground">{{ data.title }}</h4>
                  <p class="text-xs text-muted">{{ data.subtitle }}</p>
                </div>
              </div>
            </div>
          </template>
        </VueFlow>
      </div>

      <!-- Properties Panel (Right Drawer) -->
      <div 
        v-if="isPropertiesPanelOpen" 
        class="w-96 border-l border-default bg-elevated h-full flex flex-col shrink-0 z-20 absolute right-0 top-0 bottom-0 shadow-xl"
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

          <!-- Trigger Node Configuration -->
          <template v-if="selectedNode.type === 'trigger'">
            <div class="space-y-3">
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
                <UTextarea
                  autoresize
                  :rows="5"
                  class="w-full text-xs"
                  v-model="selectedNode.data.prompt"
                  @input="onNodeDataChange"
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
        </div>
      </div>
    </div>

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
                  @click="window.open(log.authUrl, '_blank')"
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
