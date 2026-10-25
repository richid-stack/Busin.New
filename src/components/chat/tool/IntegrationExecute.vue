<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActionSteps from './ActionSteps.vue'
import { accentGradient } from '../../../utils/accentGradient'
import { appLogo } from '../../../utils/appLogo'

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

const providerIcon = computed(() => {
  if (toolResult.value?.icon) return toolResult.value.icon
  return appLogo(providerRaw.value)
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
// The app's logo stays on the row. A failure is shown by the red text and step, not by swapping the logo away.
const accent = computed(() => accentGradient(providerDisplayName.value))
</script>

<template>
  <!-- Connecting an account is the one moment worth a card: the app's logo, what is waiting, and the button. -->
  <div
    v-if="requiresAuth"
    :class="['rounded-3xl p-3 sm:p-4 min-w-0 max-w-full', accent]"
  >
    <div class="rounded-2xl border border-default bg-default/80 backdrop-blur shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div class="size-12 sm:size-14 rounded-xl bg-default border border-default shadow-sm flex items-center justify-center shrink-0">
        <UIcon
          :name="providerIcon"
          class="size-6 sm:size-7"
        />
      </div>
      <div class="min-w-0 flex-1">
        <h4 class="text-sm font-semibold text-highlighted m-0">
          Connect {{ providerDisplayName }}
        </h4>
        <p class="text-xs text-muted mt-1 m-0 leading-relaxed line-clamp-2">
          To do this for you: {{ instruction }}
        </p>
        <p class="text-xs text-dimmed mt-1 m-0">
          You can disconnect at any time.
        </p>
      </div>
      <UButton
        :to="authUrl"
        target="_blank"
        :label="`Connect ${providerDisplayName}`"
        color="neutral"
        trailing-icon="i-lucide-arrow-up-right"
        class="shrink-0 justify-center"
      />
    </div>
  </div>

  <UChatTool
    v-else
    v-model:open="open"
    class="min-w-0 max-w-full"
    :text="heading"
    :suffix="instruction"
    :streaming="isExecuting"
    :icon="providerIcon"
    chevron="trailing"
    :ui="!isExecuting && !isSuccess ? { label: 'text-error' } : undefined"
  >
    <div class="flex flex-col gap-1.5 ml-2 pl-3 border-l border-default">
      <ActionSteps :steps="steps" />
      <p
        v-if="!isExecuting && !isSuccess"
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
