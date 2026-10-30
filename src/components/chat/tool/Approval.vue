<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { getToolName } from 'ai'
import { accentGradient } from '../../../utils/accentGradient'
import { appLogo } from '../../../utils/appLogo'
import { mcpLogo } from '../../../utils/mcpLogo'

const props = defineProps<{ part: any, /** What will be done, when the tool cannot say it in its own inputs (the browser). */ instruction?: string, /** Replaces the tool's name in the heading (the site, for the browser). */ label?: string, /** Not a yes/no question: the page needs you to do something (sign in, a code), then press Continue. */ person?: boolean }>()

type Respond = (approvalId: string, approved: boolean) => void | Promise<void>
const respond = inject<Respond | null>('respondToToolApproval', null)
const answered = ref<boolean | null>(null)

const toolName = computed(() => getToolName(props.part) || 'tool')
const input = computed<Record<string, unknown>>(() => (props.part.input && typeof props.part.input === 'object' ? props.part.input : {}))
const isApp = computed(() => toolName.value === 'integration_execute')
const isMcp = computed(() => toolName.value.startsWith('mcp_'))
const isBrowser = computed(() => toolName.value === 'browser')

const SPELLING: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', onedrive: 'OneDrive', one_drive: 'OneDrive', hubspot: 'HubSpot', paystack: 'Paystack', google_drive: 'Google Drive', google_calendar: 'Google Calendar' }
const words = (text: string) => text.replace(/[_-]+/g, ' ').trim()
const title = computed(() => {
  if (isApp.value) {
    const slug = String(input.value.provider || 'an app').toLowerCase().trim().replace(/[- ]/g, '_')
    return SPELLING[slug] ?? words(slug).replace(/\b\w/g, c => c.toUpperCase())
  }
  if (isMcp.value) return words(toolName.value.slice(4))
  if (isBrowser.value) return props.label || 'a website'
  return words(toolName.value)
})
const logo = computed(() => (isApp.value ? appLogo(String(input.value.provider || '')) : isBrowser.value ? 'i-lucide-globe' : mcpLogo(toolName.value)))
const kind = computed(() => isApp.value ? 'App action' : isMcp.value ? 'Tool from an outside server' : isBrowser.value ? 'Browser step' : 'Action')

/** What will be done, in the person's own terms: the instruction for apps, the inputs for tools. */
const instruction = computed(() => props.instruction || (isApp.value ? String(input.value.instruction || '') : ''))
const fields = computed(() => isBrowser.value ? [] : Object.entries(input.value)
  .filter(([key]) => !(isApp.value && ['provider', 'instruction', 'access'].includes(key)))
  .map(([key, value]) => ({ key: words(key), value: (typeof value === 'string' ? value : JSON.stringify(value)) ?? '' }))
  .slice(0, 12))

async function answer(approved: boolean) {
  if (answered.value !== null || !props.part.approval?.id) return
  answered.value = approved
  await respond?.(props.part.approval.id, approved)
}
</script>

<template>
  <!-- A decision about something that changes things: the app's logo, exactly what will happen, and two clear buttons. -->
  <div
    :class="['my-2 rounded-3xl p-3 sm:p-4 min-w-0 max-w-full', accentGradient(title)]"
    role="group"
    :aria-label="`Approval needed: ${title}`"
  >
    <div class="rounded-2xl border border-default bg-default/80 backdrop-blur shadow-sm p-4 sm:p-5 flex flex-col gap-4">
      <div class="flex items-start gap-3.5">
        <div class="size-11 rounded-xl bg-default border border-default shadow-sm flex items-center justify-center shrink-0">
          <UIcon
            :name="logo || 'i-lucide-shield-question'"
            class="size-6"
            :class="logo ? '' : 'text-warning'"
          />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-highlighted">
            {{ person ? 'This page needs you' : 'Approve this before it runs' }}
          </p>
          <p class="text-xs text-muted mt-0.5">
            {{ kind }} · <span class="text-default font-medium">{{ title }}</span>. {{ person ? 'Press Take over on the page, do it yourself, then press Continue.' : 'It may change things or reach other people.' }}
          </p>
        </div>
      </div>

      <p
        v-if="instruction"
        class="text-sm text-default whitespace-pre-wrap break-words rounded-xl bg-elevated/50 border border-default px-3.5 py-2.5"
      >
        {{ instruction }}
      </p>

      <dl
        v-if="fields.length"
        class="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-elevated/50 border border-default px-3.5 py-2.5"
      >
        <template
          v-for="f in fields"
          :key="f.key"
        >
          <dt class="text-muted capitalize">
            {{ f.key }}
          </dt>
          <dd class="text-default font-mono break-words line-clamp-4">
            {{ f.value }}
          </dd>
        </template>
      </dl>

      <div class="flex items-center justify-end gap-2">
        <UButton
          v-if="!person"
          label="Decline"
          color="neutral"
          variant="ghost"
          :disabled="answered !== null"
          @click="answer(false)"
        />
        <UButton
          :label="person ? 'Continue' : 'Approve'"
          icon="i-lucide-check"
          color="neutral"
          :loading="answered === true"
          :disabled="answered !== null"
          @click="answer(true)"
        />
      </div>
    </div>
  </div>
</template>
