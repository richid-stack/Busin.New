<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  invocation: any
}>()

const copied = ref(false)

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

const isExecuting = computed(() => {
  if (props.invocation?.state === 'call' || props.invocation?.toolInvocation?.state === 'call') return true
  return !isCompleted.value
})

const providerRaw = computed(() => {
  return (toolResult.value?.provider || toolArgs.value?.provider || 'service').toString().toLowerCase().trim()
})

// Map provider slugs to authentic official brand logos
const BRAND_ICON_MAP: Record<string, string> = {
  github: 'i-logos-github-icon',
  gh: 'i-logos-github-icon',
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
  google_sheets: 'i-logos-google-sheets',
  sheets: 'i-logos-google-sheets',
  google_docs: 'i-logos-google-docs',
  docs: 'i-logos-google-docs',
  google_calendar: 'i-logos-google-calendar',
  calendar: 'i-logos-google-calendar',
  google_tasks: 'i-logos-google-tasks',
  tasks: 'i-logos-google-tasks',
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

const toolCallsCount = computed(() => {
  return toolResult.value?.output?.toolCalls || toolResult.value?.toolCallsCount || 1
})

function copyOutput() {
  if (outputText.value) {
    navigator.clipboard.writeText(outputText.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  }
}
</script>

<template>
  <div class="my-3 font-sans w-full max-w-2xl">
    <!-- STATE 1: AUTHENTICATION / CONNECTION REQUIRED -->
    <div
      v-if="requiresAuth"
      class="relative overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-b from-neutral-50/90 to-neutral-100/50 dark:from-neutral-900/90 dark:to-neutral-950/60 p-5 shadow-xs transition-all"
    >
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-start sm:items-center gap-3.5 min-w-0">
          <!-- Authentic Brand Favicon / Logo Container -->
          <div
            class="size-11 sm:size-12 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700/60 shadow-xs flex items-center justify-center shrink-0"
          >
            <UIcon :name="providerIcon" class="size-6 sm:size-7 text-default" />
          </div>

          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20"
              >
                <UIcon name="i-lucide-shield-alert" class="size-3" />
                Connection Required
              </span>
            </div>
            <h4 class="text-base font-semibold text-default tracking-tight m-0">
              Connect {{ providerDisplayName }}
            </h4>
            <p class="text-xs text-muted mt-0.5 m-0 leading-relaxed">
              Authorize this account so the agent can execute real actions autonomously.
            </p>
          </div>
        </div>

        <!-- Connect Action Button -->
        <div class="shrink-0 flex items-center gap-2 self-start sm:self-center">
          <UButton
            :to="authUrl"
            target="_blank"
            color="primary"
            variant="solid"
            size="md"
            class="rounded-xl px-4 py-2 font-medium shadow-xs hover:shadow-md transition-all whitespace-nowrap"
          >
            Connect {{ providerDisplayName }}
            <template #trailing>
              <UIcon name="i-lucide-arrow-up-right" class="size-4" />
            </template>
          </UButton>
        </div>
      </div>

      <!-- Action Context Box -->
      <div
        class="mt-4 p-3 rounded-xl bg-white/80 dark:bg-neutral-900/80 border border-neutral-200/70 dark:border-neutral-800/80 flex items-start gap-2.5 text-xs text-muted"
      >
        <UIcon name="i-lucide-terminal" class="size-4 shrink-0 text-muted mt-0.5" />
        <div class="min-w-0 leading-relaxed">
          <span class="font-medium text-default">Requested Operation:</span>
          <span class="ml-1 text-default">{{ instruction }}</span>
        </div>
      </div>
    </div>

    <!-- STATE 2: ACTION EXECUTING / STREAMING -->
    <div
      v-else-if="isExecuting"
      class="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-xs flex items-center gap-3.5"
    >
      <div class="size-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 border border-neutral-200/60 dark:border-neutral-700/60">
        <UIcon :name="providerIcon" class="size-5 text-default" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-default">Executing on {{ providerDisplayName }}</span>
          <UIcon name="i-lucide-loader-2" class="size-3.5 text-muted animate-spin shrink-0" />
        </div>
        <p class="text-xs text-muted truncate mt-0.5 m-0">{{ instruction }}</p>
      </div>
    </div>

    <!-- STATE 3: EXECUTION SUCCESS -->
    <div
      v-else-if="isSuccess"
      class="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 sm:p-5 shadow-xs transition-all"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 border border-neutral-200/60 dark:border-neutral-700/60">
            <UIcon :name="providerIcon" class="size-5 text-default" />
          </div>

          <div>
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-semibold text-default m-0">
                {{ providerDisplayName }}
              </h4>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                <UIcon name="i-lucide-check-circle-2" class="size-3" />
                Action Completed
              </span>
              <span v-if="toolCallsCount > 1" class="text-[11px] text-muted font-medium">
                {{ toolCallsCount }} steps
              </span>
            </div>
            <p class="text-xs text-muted mt-0.5 m-0 line-clamp-1">
              {{ instruction }}
            </p>
          </div>
        </div>

        <div v-if="outputText" class="shrink-0">
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :label="copied ? 'Copied' : 'Copy'"
            class="text-xs"
            @click="copyOutput"
          />
        </div>
      </div>

      <!-- Execution Output Display -->
      <div
        v-if="outputText"
        class="mt-3.5 p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-950/70 border border-neutral-200/70 dark:border-neutral-800/80 text-xs text-default font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto"
      >
        {{ outputText }}
      </div>
    </div>

    <!-- STATE 4: EXECUTION ERROR -->
    <div
      v-else
      class="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-4 shadow-xs"
    >
      <div class="flex items-start gap-3">
        <div class="size-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0 text-red-600 dark:text-red-400">
          <UIcon name="i-lucide-alert-circle" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-red-800 dark:text-red-300">
            Action Failed on {{ providerDisplayName }}
          </div>
          <p class="text-xs text-red-700/80 dark:text-red-400/80 mt-1 m-0">
            {{ errorMessage }}
          </p>
          <div v-if="authUrl" class="mt-3">
            <UButton
              :to="authUrl"
              target="_blank"
              color="error"
              variant="subtle"
              size="xs"
              icon="i-lucide-refresh-cw"
              label="Check Authorization"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
