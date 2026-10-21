<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import VariablePicker from './VariablePicker.vue'
import VariableTextarea from './VariableTextarea.vue'
import HttpFields from './fields/HttpFields.vue'
import WebFetchFields from './fields/WebFetchFields.vue'
import SetFields from './fields/SetFields.vue'
import ErrorSettings from './fields/ErrorSettings.vue'
import ScheduleFields from './fields/ScheduleFields.vue'
import { STATUS_META, logicKind } from '../../utils/workflowGraph'
import type { NodeRuntime } from '../../utils/workflowGraph'
import type { IntegrationItem } from '../../types/integrations'
import { MODELS } from '../../../shared/utils/models'

const props = defineProps<{
  node: { id: string, type: string, data: Record<string, any> } | null
  variables: Array<{ group: string, label: string, value: string, icon?: string }>
  integrations: IntegrationItem[]
  canConnect: boolean
  connectingProvider: string | null
  webhookUrl: string
  webhookSecret?: string
  workflowActive: boolean
  scheduleNextRunAt?: string | null
  scheduleError?: string | null
  runtime?: NodeRuntime
  testing: boolean
  testResult: { status: string, output?: any, message?: string, durationMs?: number, authUrl?: string } | null
}>()

const emit = defineEmits<{
  close: []
  update: [patch: Record<string, any>]
  connect: [provider: string]
  test: [inputs: Record<string, any>]
}>()

const tab = ref<'config' | 'test'>('config')
const testInput = ref('{\n  "trigger": {}\n}')
const testInputError = computed(() => {
  try {
    const parsed = JSON.parse(testInput.value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : 'Input must be a JSON object.'
  } catch (error: any) {
    return `Invalid JSON: ${error?.message || 'could not parse'}`
  }
})

// A different node was selected: start on its configuration.
watch(() => props.node?.id, () => {
  tab.value = 'config'
})

const { copy, copied } = useClipboard()
const showSecret = ref(false)

const data = computed(() => props.node?.data ?? {})
const kind = computed(() => logicKind({ id: props.node?.id ?? '', data: data.value }))
const config = computed<Record<string, any>>(() => data.value.config ?? {})

function set(key: string, value: any) {
  emit('update', { [key]: value })
}
function setConfig(key: string, value: any) {
  emit('update', { config: { ...config.value, [key]: value } })
}
function patchConfig(patch: Record<string, any>) {
  emit('update', { config: { ...config.value, ...patch } })
}

// What this action does: call a web address, read a page, or use a connected app.
const actionKind = computed<'http' | 'web-fetch' | 'app'>(() => (data.value.subtype === 'api' ? 'http' : data.value.subtype === 'web-fetch' ? 'web-fetch' : 'app'))

// Loop: one small step repeated for every item in a list.
const loopBody = computed<Record<string, any>>(() => config.value.body ?? { kind: 'web-fetch', config: {} })
const loopBodyConfig = computed<Record<string, any>>(() => loopBody.value.config ?? {})
const LOOP_KINDS = [
  { label: 'Read a web page', value: 'web-fetch' },
  { label: 'Send an HTTP request', value: 'http' },
  { label: 'Set fields', value: 'set' },
  { label: 'Ask the AI', value: 'agent' }
]
function patchLoopBody(patch: Record<string, any>) {
  patchConfig({ body: { ...loopBody.value, ...patch } })
}
function patchLoopBodyConfig(patch: Record<string, any>) {
  patchLoopBody({ config: { ...loopBodyConfig.value, ...patch } })
}
function changeLoopKind(kind: string) {
  const defaults: Record<string, Record<string, any>> = {
    'web-fetch': { url: '{{item}}' },
    'http': { method: 'GET', url: '{{item}}' },
    'set': { fields: [{ key: 'value', value: '{{item}}', mode: 'text' }] },
    'agent': {}
  }
  patchLoopBody({ kind, config: defaults[kind] ?? {} })
}
const loopCap = computed(() => (loopBody.value.kind === 'agent' ? 10 : 50))
// Inside a loop's step, {{item}} and {{index}} are available as well.
const loopVariables = computed(() => [
  { group: 'This loop', label: 'Current item', value: '{{item}}', icon: 'i-lucide-repeat' },
  { group: 'This loop', label: 'Item number (from 0)', value: '{{index}}', icon: 'i-lucide-hash' },
  ...props.variables
])

// Steps where "if this fails" settings make sense; retries only where repeating can help.
const showFailureSettings = computed(() => props.node?.type === 'agent' || props.node?.type === 'action' || (props.node?.type === 'logic' && (kind.value === 'set' || kind.value === 'loop')))
const canRetry = computed(() => props.node?.type === 'agent' || props.node?.type === 'action')

const providerItems = computed(() => {
  const items = props.integrations
    .map(i => ({ label: i.name, value: i.provider, icon: i.icon }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const current = data.value.provider
  if (current && !items.some(i => i.value === current)) {
    items.unshift({ label: current, value: current, icon: 'i-lucide-box' })
  }
  return items
})

const integration = computed(() => props.integrations.find(i => i.provider === data.value.provider))
const isConnected = computed(() => integration.value?.status === 'connected')

function changeProvider(provider: string) {
  const match = props.integrations.find(i => i.provider === provider)
  emit('update', {
    provider,
    ...(match ? { icon: match.icon, subtitle: `Action • ${match.name}` } : {})
  })
}

const triggerMode = computed(() => {
  const subtype = data.value.subtype
  if (subtype === 'webhook') return 'webhook'
  if (subtype === 'manual') return 'manual'
  if (subtype === 'schedule') return 'schedule'
  return 'unsupported'
})

const maskedSecret = computed(() => props.webhookSecret ? '•'.repeat(24) : '')

function runTest() {
  if (testInputError.value) return
  emit('test', JSON.parse(testInput.value))
}

const resultMeta = computed(() => (props.testResult ? STATUS_META[props.testResult.status] : null))
const lastRun = computed(() => props.runtime?.output !== undefined ? props.runtime : null)

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="p-4 border-b border-default flex items-center justify-between shrink-0">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sliders-horizontal" class="size-4 text-muted" />
        <span class="font-semibold text-sm text-default">Node configuration</span>
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        size="xs"
        aria-label="Close panel"
        @click="emit('close')"
      />
    </div>

    <div v-if="!node" class="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div class="size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center mb-4">
        <UIcon name="i-lucide-mouse-pointer-click" class="size-5 text-muted" />
      </div>
      <h3 class="text-sm font-medium text-highlighted mb-1">Select a node</h3>
      <p class="text-xs text-muted leading-relaxed">Click any step on the canvas to configure it and test it on its own.</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4 space-y-4">
      <div class="flex items-center gap-3 p-3 border border-default rounded-lg">
        <div class="p-2 bg-default rounded-md border border-default shrink-0">
          <UIcon :name="data.icon || 'i-lucide-box'" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <UInput
            :model-value="data.title"
            variant="none"
            size="sm"
            class="w-full"
            :ui="{ base: 'p-0 font-semibold text-sm text-default' }"
            aria-label="Node name"
            @update:model-value="set('title', $event)"
          />
          <p class="text-xs text-muted uppercase tracking-wider">{{ node.type }} node</p>
        </div>
      </div>

      <UTabs
        v-model="tab"
        :items="[{ label: 'Configuration', value: 'config' }, { label: 'Test step', value: 'test' }]"
        :content="false"
        size="sm"
        class="w-full"
      />

      <!-- Configuration -->
      <div v-if="tab === 'config'" class="space-y-4">
        <!-- Trigger -->
        <template v-if="node.type === 'trigger'">
          <template v-if="triggerMode === 'webhook'">
            <UAlert
              v-if="!workflowActive"
              color="warning"
              variant="subtle"
              icon="i-lucide-rocket"
              title="Deploy to receive calls"
              description="The webhook only accepts requests while this workflow is active. Use Deploy in the top bar."
            />
            <UFormField label="Webhook URL" size="sm" help="Send a POST request to this URL to start a run.">
              <div class="flex items-center gap-2">
                <UInput :model-value="webhookUrl" readonly size="sm" class="flex-1" :ui="{ base: 'font-mono text-[11px]' }" />
                <UButton
                  :color="copied ? 'success' : 'neutral'"
                  variant="soft"
                  :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                  size="sm"
                  aria-label="Copy URL"
                  @click="copy(webhookUrl)"
                />
              </div>
            </UFormField>
            <UFormField
              v-if="webhookSecret"
              label="Webhook secret"
              size="sm"
              help="Send it as the x-webhook-secret header. Keep it private."
            >
              <div class="flex items-center gap-2">
                <UInput
                  :model-value="showSecret ? webhookSecret : maskedSecret"
                  readonly
                  size="sm"
                  class="flex-1"
                  :ui="{ base: 'font-mono text-[11px]' }"
                />
                <UButton
                  color="neutral"
                  variant="soft"
                  :icon="showSecret ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  size="sm"
                  :aria-label="showSecret ? 'Hide secret' : 'Show secret'"
                  @click="showSecret = !showSecret"
                />
                <UButton
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-copy"
                  size="sm"
                  aria-label="Copy secret"
                  @click="copy(webhookSecret)"
                />
              </div>
            </UFormField>
          </template>

          <ScheduleFields
            v-else-if="triggerMode === 'schedule'"
            :schedule="data.schedule"
            :active="workflowActive"
            :next-run-at="scheduleNextRunAt"
            :error="scheduleError"
            @update="set('schedule', $event)"
          />

          <UAlert
            v-else-if="triggerMode === 'manual'"
            color="neutral"
            variant="subtle"
            icon="i-lucide-play-circle"
            title="Starts when you run it"
            description="Use Test Run in the top bar, or ask OpenLobs in chat to run this workflow."
          />

          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-lucide-clock"
            title="This trigger is not live yet"
            description="This workflow will not start by itself when email arrives. Start it with Test Run, a webhook, a schedule, or from chat."
          />
        </template>

        <!-- AI agent -->
        <template v-else-if="node.type === 'agent'">
          <UFormField label="AI model" size="sm">
            <USelect
              :model-value="data.model"
              :items="MODELS"
              size="md"
              class="w-full"
              @update:model-value="set('model', $event)"
            />
          </UFormField>
          <UFormField label="Instructions" size="sm" help="Use the brackets button to insert output from earlier steps.">
            <VariableTextarea
              :model-value="data.prompt || ''"
              :variables="variables"
              placeholder="You are an intelligent workflow automation agent..."
              :rows="6"
              @update:model-value="set('prompt', $event)"
            />
          </UFormField>
        </template>

        <!-- Logic -->
        <template v-else-if="node.type === 'logic'">
          <UFormField v-if="kind === 'if-else'" label="Condition" size="sm">
            <VariablePicker
              :model-value="data.condition || ''"
              :variables="variables"
              @update:model-value="set('condition', $event)"
            />
          </UFormField>
          <UFormField v-else-if="kind === 'switch'" label="Switch value" size="sm">
            <VariablePicker
              :model-value="data.switchVar || ''"
              :variables="variables"
              @update:model-value="set('switchVar', $event)"
            />
          </UFormField>
          <UFormField v-else-if="kind === 'code'" label="JavaScript" size="sm" help="Return a value. It becomes this step's output.">
            <VariableTextarea
              :model-value="data.code || ''"
              :variables="variables"
              placeholder="return { formattedDate: new Date().toISOString() };"
              :rows="8"
              @update:model-value="set('code', $event)"
            />
          </UFormField>
          <SetFields
            v-else-if="kind === 'set'"
            :config="config"
            :variables="variables"
            @update="patchConfig"
          />
          <template v-else-if="kind === 'loop'">
            <UFormField label="List to go over" size="sm" help="Must be a list, such as the urls in a webhook payload.">
              <VariablePicker
                :model-value="config.items || ''"
                :variables="variables"
                placeholder="{{trigger.payload.urls}}"
                @update:model-value="setConfig('items', $event)"
              />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Most items" size="sm" :help="`Up to ${loopCap}. Extra items are left out and reported.`">
                <UInput
                  :model-value="config.maxItems ?? 20"
                  type="number"
                  :min="1"
                  :max="loopCap"
                  size="sm"
                  class="w-full"
                  @update:model-value="setConfig('maxItems', Math.min(loopCap, Math.max(1, Number($event) || 20)))"
                />
              </UFormField>
              <UFormField label="Stop on first error" size="sm" help="Off: failed items are reported and the rest continue.">
                <USwitch
                  :model-value="Boolean(config.stopOnError)"
                  aria-label="Fail the step when any item fails"
                  @update:model-value="setConfig('stopOnError', $event)"
                />
              </UFormField>
            </div>
            <UFormField label="For each item" size="sm" help="Use {{item}} and {{index}} in the fields below.">
              <USelect
                :model-value="loopBody.kind || 'web-fetch'"
                :items="LOOP_KINDS"
                size="md"
                class="w-full"
                @update:model-value="changeLoopKind($event as string)"
              />
            </UFormField>
            <WebFetchFields v-if="(loopBody.kind || 'web-fetch') === 'web-fetch'" :config="loopBodyConfig" :variables="loopVariables" @update="patchLoopBodyConfig" />
            <HttpFields v-else-if="loopBody.kind === 'http'" :config="loopBodyConfig" :variables="loopVariables" @update="patchLoopBodyConfig" />
            <SetFields v-else-if="loopBody.kind === 'set'" :config="loopBodyConfig" :variables="loopVariables" @update="patchLoopBodyConfig" />
            <template v-else-if="loopBody.kind === 'agent'">
              <UFormField label="AI model" size="sm">
                <USelect :model-value="loopBody.model" :items="MODELS" size="md" class="w-full" @update:model-value="patchLoopBody({ model: $event })" />
              </UFormField>
              <UFormField label="Instructions" size="sm" help="Runs once per item, so keep the list short. The AI sees the item as {{item}}.">
                <VariableTextarea
                  :model-value="loopBody.prompt || ''"
                  :variables="loopVariables"
                  placeholder="Summarise {{item}} in one sentence."
                  :rows="4"
                  @update:model-value="patchLoopBody({ prompt: $event })"
                />
              </UFormField>
            </template>
            <p class="text-xs text-muted">
              Output: <code class="font-mono">results</code> (one entry per item, in order), <code class="font-mono">outputs</code> (only the ones that worked), <code class="font-mono">succeeded</code>, <code class="font-mono">failed</code>.
            </p>
          </template>
          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-lucide-construction"
            title="Not available yet"
            description="This kind of logic step cannot run yet. Use If / Else, Switch, JavaScript, Set or Loop."
          />
        </template>

        <!-- Approval -->
        <template v-else-if="node.type === 'approval'">
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-user-check"
            title="Pauses the run"
            description="The workflow stops here until you approve or reject it, in chat or from the run result."
          />
          <UFormField label="Approver role" size="sm">
            <UInput
              :model-value="data.approverRole || ''"
              placeholder="Admin"
              size="sm"
              class="w-full"
              @update:model-value="set('approverRole', $event)"
            />
          </UFormField>
          <UFormField label="What should be reviewed?" size="sm">
            <VariableTextarea
              :model-value="data.approvalPrompt || ''"
              :variables="variables"
              placeholder="Please review the draft before it is sent."
              :rows="4"
              @update:model-value="set('approvalPrompt', $event)"
            />
          </UFormField>
        </template>

        <!-- Action -->
        <template v-else-if="node.type === 'action' && actionKind === 'http'">
          <HttpFields :config="config" :variables="variables" @update="patchConfig" />
        </template>
        <template v-else-if="node.type === 'action' && actionKind === 'web-fetch'">
          <WebFetchFields :config="config" :variables="variables" @update="patchConfig" />
        </template>
        <template v-else-if="node.type === 'action'">
          <UFormField label="App" size="sm">
            <USelect
              :model-value="data.provider || undefined"
              :items="providerItems"
              placeholder="Choose an app"
              size="md"
              class="w-full"
              @update:model-value="changeProvider($event as string)"
            />
          </UFormField>

          <div v-if="data.provider" class="p-3 rounded-lg border border-default flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="size-2 rounded-full" :class="isConnected ? 'bg-success' : 'bg-muted'" />
                <span class="text-xs font-medium text-default">{{ isConnected ? 'Connected' : 'Not connected' }}</span>
              </div>
              <p class="text-[11px] text-muted truncate mt-0.5">
                {{ isConnected ? integration?.account : canConnect ? 'Authorize this app to run the step.' : 'Connections are not set up on this server.' }}
              </p>
            </div>
            <UButton
              v-if="!isConnected"
              label="Connect"
              color="primary"
              size="xs"
              :disabled="!canConnect"
              :loading="connectingProvider === data.provider"
              @click="emit('connect', data.provider)"
            />
          </div>

          <UFormField v-if="data.provider === 'slack'" label="Slack channel" size="sm">
            <UInput
              :model-value="data.channel || ''"
              placeholder="#client-alerts"
              size="sm"
              class="w-full"
              @update:model-value="set('channel', $event)"
            />
          </UFormField>
          <UFormField v-else-if="data.provider === 'google_drive'" label="Drive folder" size="sm">
            <UInput
              :model-value="data.folder || ''"
              placeholder="/Client Proposals"
              size="sm"
              class="w-full"
              @update:model-value="set('folder', $event)"
            />
          </UFormField>

          <UFormField
            label="What should it do?"
            size="sm"
            help="Describe the action in plain language. Insert earlier results with the brackets button."
          >
            <VariableTextarea
              :model-value="config.instruction || ''"
              :variables="variables"
              placeholder="Post a short summary of the proposal to the channel."
              :rows="4"
              @update:model-value="setConfig('instruction', $event)"
            />
          </UFormField>
        </template>

        <ErrorSettings
          v-if="showFailureSettings"
          :settings="data.settings"
          :can-retry="canRetry"
          :retry-note="kind === 'loop' ? 'A loop is never retried as a whole, because that could repeat items that already worked.' : undefined"
          @update="set('settings', $event)"
        />
      </div>

      <!-- Test step -->
      <div v-else class="space-y-4">
        <UFormField
          label="Mock input (JSON)"
          size="sm"
          help="Simulates the data this step receives from earlier steps, keyed by node id."
          :error="testInputError || undefined"
        >
          <UTextarea v-model="testInput" class="w-full" :ui="{ base: 'font-mono text-xs' }" :rows="8" />
        </UFormField>
        <UButton
          label="Test this step"
          icon="i-lucide-play"
          color="primary"
          size="sm"
          block
          :loading="testing"
          :disabled="Boolean(testInputError)"
          @click="runTest"
        />

        <div v-if="testResult" class="space-y-2 pt-4 border-t border-default">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-default">Result</span>
            <UBadge
              v-if="resultMeta"
              :label="`${resultMeta.label}${testResult.durationMs ? ` · ${testResult.durationMs}ms` : ''}`"
              :color="resultMeta.color"
              variant="subtle"
              size="sm"
            />
          </div>
          <p v-if="testResult.message" class="text-xs text-muted">{{ testResult.message }}</p>
          <pre v-if="testResult.output != null" class="border border-default bg-default p-2 rounded-md text-[10px] font-mono overflow-auto max-h-64">{{ pretty(testResult.output) }}</pre>
          <UButton
            v-if="testResult.authUrl"
            label="Authorize app"
            color="warning"
            variant="soft"
            size="xs"
            :to="testResult.authUrl"
            target="_blank"
          />
        </div>

        <div v-else-if="lastRun" class="space-y-2 pt-4 border-t border-default">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-default">Output from the last run</span>
            <UBadge
              v-if="lastRun.status && STATUS_META[lastRun.status]"
              :label="STATUS_META[lastRun.status]!.label"
              :color="STATUS_META[lastRun.status]!.color"
              variant="subtle"
              size="sm"
            />
          </div>
          <pre class="border border-default bg-default p-2 rounded-md text-[10px] font-mono overflow-auto max-h-64">{{ pretty(lastRun.output) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
