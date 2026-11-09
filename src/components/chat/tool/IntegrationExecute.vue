<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActionSteps from './ActionSteps.vue'

const props = defineProps<{
  invocation: any
}>()

// Extract args/input flexibly to support various AI SDK part schemas
const toolArgs = computed(() => {
  return props.invocation?.input || props.invocation?.args || props.invocation?.toolInvocation?.args || {}
})

// Extract result/output flexibly
const toolResult = computed(() => {
  return props.invocation?.output || props.invocation?.result || props.invocation?.toolInvocation?.result || null
})

// State handling
const isCompleted = computed(() => {
  return toolResult.value !== null && toolResult.value !== undefined
})

const steps = computed<Array<{ label: string, status: 'running' | 'done' | 'failed', detail?: string }>>(() => {
  const list = toolResult.value?.steps ?? toolResult.value?.output?.steps
  return Array.isArray(list) ? list : []
})

const isExecuting = computed(() => {
  if (props.invocation?.state === 'call' || props.invocation?.toolInvocation?.state === 'call') return true
  // A progress update arrives as a partial result; the task is still going until the final one.
  if (props.invocation?.preliminary === true || toolResult.value?.running === true) return true
  return !isCompleted.value
})

const providerRaw = computed(() => {
  return (toolResult.value?.provider || toolArgs.value?.provider || 'service').toString().toLowerCase().trim()
})

// Map provider slugs to authentic official brand logos
const BRAND_ICON_MAP: Record<string, string> = {
  github: 'i-brand-github',
  gh: 'i-brand-github',
  slack: 'i-logos-slack-icon',
  discord: 'i-logos-discord-icon',
  linear: 'i-logos-linear-icon',
  notion: 'i-logos-notion-icon',
  jira: 'i-logos-jira',
  salesforce: 'i-logos-salesforce',
  airtable: 'i-logos-airtable',
  stripe: 'i-logos-stripe',
  gitlab: 'i-logos-gitlab',
  trello: 'i-logos-trello',
  asana: 'i-logos-asana-icon',
  gmail: 'i-logos-google-gmail',
  google_drive: 'i-logos-google-drive',
  drive: 'i-logos-google-drive',
  google_sheets: 'i-simple-icons:googlesheets',
  sheets: 'i-simple-icons:googlesheets',
  google_docs: 'i-simple-icons:googledocs',
  docs: 'i-simple-icons:googledocs',
  google_calendar: 'i-logos-google-calendar',
  calendar: 'i-logos-google-calendar',
  google_tasks: 'i-simple-icons:googletasks',
  tasks: 'i-simple-icons:googletasks',
  microsoft_teams: 'i-logos-microsoft-teams',
  teams: 'i-logos-microsoft-teams',
  outlook: 'i-logos-microsoft-icon',
  one_drive: 'i-logos-microsoft-onedrive',
  onedrive: 'i-logos-microsoft-onedrive',
  zendesk: 'i-logos-zendesk-icon'
}

const providerIcon = computed(() => {
  const p = providerRaw.value.replace(/[- ]/g, '_')
  if (BRAND_ICON_MAP[p]) return BRAND_ICON_MAP[p]
  if (toolResult.value?.icon) return toolResult.value.icon
  return 'i-lucide-layers'
})

const providerDisplayName = computed(() => {
  if (toolResult.value?.providerName) return toolResult.value.providerName
  const p = providerRaw.value.replace(/_/g, ' ')
  if (p === 'github') return 'GitHub'
  if (p === 'gmail') return 'Gmail'
  if (p === 'google drive' || p === 'drive') return 'Google Drive'
  if (p === 'google sheets' || p === 'sheets') return 'Google Sheets'
  if (p === 'google docs' || p === 'docs') return 'Google Docs'
  if (p === 'google calendar' || p === 'calendar') return 'Google Calendar'
  if (p === 'microsoft teams' || p === 'teams') return 'Microsoft Teams'
  return p.charAt(0).toUpperCase() + p.slice(1)
})

const instruction = computed(() => {
  return toolResult.value?.instruction || toolArgs.value?.instruction || 'Automated integration operation'
})

const requiresAuth = computed(() => {
  return toolResult.value?.authRequired === true
})

const authUrl = computed(() => {
  return toolResult.value?.authUrl || `/integrations/${providerRaw.value}`
})

const isSuccess = computed(() => {
  return toolResult.value?.success === true
})

const outputText = computed(() => {
  const result = toolResult.value
  if (!result) return ''
  // `output` is an object ({ summary, toolCalls }) for runner results and plain text for older messages.
  if (typeof result.output === 'string') return result.output
  return result.output?.summary || result.message || ''
})

const errorMessage = computed(() => {
  return toolResult.value?.error || toolResult.value?.message || 'Execution failed'
})

// The steps open on their own the first time they appear, so what it is doing is visible without a click.
const open = ref(false)
watch(() => steps.value.length > 0, (has) => { if (has) open.value = true }, { immediate: true })

const heading = computed(() => {
  if (requiresAuth.value) return `Connect ${providerDisplayName.value}`
  if (isExecuting.value) return `Using ${providerDisplayName.value}...`
  return isSuccess.value ? `Used ${providerDisplayName.value}` : `Could not use ${providerDisplayName.value}`
})
const icon = computed(() => (requiresAuth.value ? 'i-lucide-key-round' : !isExecuting.value && !isSuccess.value ? 'i-lucide-circle-alert' : providerIcon.value))
</script>

<template>
  <UChatTool
    v-model:open="open"
    :text="heading"
    :suffix="instruction"
    :streaming="isExecuting && !requiresAuth"
    :icon="icon"
    chevron="leading"
    :ui="!isExecuting && !isSuccess && !requiresAuth ? { leadingIcon: 'text-error' } : undefined"
    :actions="requiresAuth ? [{ label: `Connect ${providerDisplayName}`, to: authUrl, target: '_blank', color: 'neutral', variant: 'subtle', trailingIcon: 'i-lucide-arrow-up-right' }] : undefined"
  >
    <div class="flex flex-col gap-1.5 ml-2 pl-3 border-l border-default">
      <p
        v-if="requiresAuth"
        class="text-xs text-muted"
      >
        Authorize your {{ providerDisplayName }} account once so actions can run on it.
      </p>
      <ActionSteps :steps="steps" />
      <p
        v-if="!isExecuting && !isSuccess && !requiresAuth"
        class="text-xs text-error"
      >
        {{ errorMessage }}
      </p>
      <p
        v-else-if="outputText && !isExecuting"
        class="text-xs text-muted whitespace-pre-wrap max-h-48 overflow-y-auto"
      >
        {{ outputText }}
      </p>
    </div>
  </UChatTool>
</template>
