<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { getToolName } from 'ai'

const props = defineProps<{ part: any }>()

type Respond = (approvalId: string, approved: boolean) => void | Promise<void>
const respond = inject<Respond | null>('respondToToolApproval', null)
const answered = ref<boolean | null>(null)

const toolName = computed(() => getToolName(props.part) || 'tool')
const input = computed<Record<string, unknown>>(() => (props.part.input && typeof props.part.input === 'object' ? props.part.input : {}))
const isApp = computed(() => toolName.value === 'integration_execute')
const isMcp = computed(() => toolName.value.startsWith('mcp_'))

const SPELLING: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', onedrive: 'OneDrive', one_drive: 'OneDrive', hubspot: 'HubSpot', paystack: 'Paystack', google_drive: 'Google Drive', google_calendar: 'Google Calendar' }
const words = (text: string) => text.replace(/[_-]+/g, ' ').trim()
const title = computed(() => {
  if (isApp.value) {
    const slug = String(input.value.provider || 'an app').toLowerCase().trim().replace(/[- ]/g, '_')
    return SPELLING[slug] ?? words(slug).replace(/\b\w/g, c => c.toUpperCase())
  }
  if (isMcp.value) return words(toolName.value.slice(4))
  return words(toolName.value)
})
const kind = computed(() => isApp.value ? 'App action' : isMcp.value ? 'Tool from an outside server' : 'Action')

/** What will be done, in the person's own terms: the instruction for apps, the inputs for tools. */
const instruction = computed(() => isApp.value ? String(input.value.instruction || '') : '')
const fields = computed(() => Object.entries(input.value)
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
  <div
    class="my-2 rounded-xl border border-warning/40 bg-warning/5 p-4 flex flex-col gap-3"
    role="group"
    :aria-label="`Approval needed: ${title}`"
  >
    <div class="flex items-start gap-3">
      <UIcon
        name="i-lucide-shield-question"
        class="size-5 text-warning mt-0.5 shrink-0"
      />
      <div class="min-w-0">
        <p class="text-sm font-semibold text-highlighted">
          Approve this before it runs
        </p>
        <p class="text-xs text-muted mt-0.5">
          {{ kind }} · <span class="text-default font-medium">{{ title }}</span>. It may change things or reach other people.
        </p>
      </div>
    </div>

    <p
      v-if="instruction"
      class="text-sm text-default whitespace-pre-wrap break-words rounded-lg bg-default/60 border border-default px-3 py-2"
    >
      {{ instruction }}
    </p>

    <dl
      v-if="fields.length"
      class="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-default/60 border border-default px-3 py-2"
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
        label="Decline"
        color="neutral"
        variant="ghost"
        :disabled="answered !== null"
        @click="answer(false)"
      />
      <UButton
        label="Approve"
        icon="i-lucide-check"
        color="neutral"
        :loading="answered === true"
        :disabled="answered !== null"
        @click="answer(true)"
      />
    </div>
  </div>
</template>
