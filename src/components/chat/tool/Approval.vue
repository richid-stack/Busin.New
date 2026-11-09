<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { getToolName } from 'ai'
import { accentGradient } from '../../../utils/accentGradient'
import { appLogo } from '../../../utils/appLogo'
import { mcpLogo } from '../../../utils/mcpLogo'
import { checkStep, commandLine } from '../../../../shared/runPlan'
import { MCP_PRESETS, presetById } from '../../../../shared/mcpCatalog'

const props = defineProps<{ part: any, /** What will be done, when the tool cannot say it in its own inputs (the browser). */ instruction?: string, /** Replaces the tool's name in the heading (the site, for the browser). */ label?: string, /** Not a yes/no question: the page needs you to do something (sign in, a code), then press Continue. */ person?: boolean }>()

type Respond = (approvalId: string, approved: boolean) => void | Promise<void>
const respond = inject<Respond | null>('respondToToolApproval', null)
const answered = ref<boolean | null>(null)

const toolName = computed(() => getToolName(props.part) || 'tool')
const input = computed<Record<string, unknown>>(() => (props.part.input && typeof props.part.input === 'object' ? props.part.input : {}))
const isApp = computed(() => toolName.value === 'integration_execute')
const isMcp = computed(() => toolName.value.startsWith('mcp_'))
const isBrowser = computed(() => toolName.value === 'browser')
const isSkill = computed(() => toolName.value === 'load_external_skill')
const isRun = computed(() => toolName.value === 'run_on_computer')
const isAdd = computed(() => toolName.value === 'add_tool_server')

/** What is shown about a server to add comes from the checked list, never from what the assistant wrote. */
const preset = computed(() => {
  if (!isAdd.value) return undefined
  const key = String(input.value.server || '').trim().toLowerCase()
  return presetById(key) ?? MCP_PRESETS.find(p => p.name.toLowerCase() === key)
})
const presetHost = computed(() => { try { return new URL(preset.value?.url || '').hostname } catch { return '' } })

/** The plan as the person reads it: each step in everyday words, the real command under it, and what to watch for. */
const plan = computed(() => {
  if (!isRun.value) return []
  const steps = Array.isArray(input.value.steps) ? input.value.steps as Array<{ program?: string, args?: string[], why?: string }> : []
  return steps.map((s, i) => {
    const c = checkStep(s)
    return {
      n: i + 1,
      words: c.ok ? c.step.words : 'A step this computer will refuse',
      command: commandLine({ program: String(s.program ?? ''), args: Array.isArray(s.args) ? s.args : [] }),
      why: String(s.why || '').trim(),
      flags: c.ok ? [c.step.network && c.step.installs ? 'Downloads packages' : c.step.network ? 'Uses the internet' : '', c.step.runsCode ? 'Runs code' : ''].filter(Boolean) : []
    }
  })
})
const anyRunsCode = computed(() => plan.value.some(s => s.flags.includes('Runs code')))

const SPELLING: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', onedrive: 'OneDrive', one_drive: 'OneDrive', hubspot: 'HubSpot', paystack: 'Paystack', google_drive: 'Google Drive', google_calendar: 'Google Calendar' }
const words = (text: string) => text.replace(/[_-]+/g, ' ').trim()
const title = computed(() => {
  if (isApp.value) {
    const slug = String(input.value.provider || 'an app').toLowerCase().trim().replace(/[- ]/g, '_')
    return SPELLING[slug] ?? words(slug).replace(/\b\w/g, c => c.toUpperCase())
  }
  if (isMcp.value) return words(toolName.value.slice(4))
  if (isBrowser.value) return props.label || 'a website'
  if (isSkill.value) return [input.value.repo, input.value.folder].filter(Boolean).join('/') || 'a skill'
  if (isRun.value) return String(input.value.computer || 'your computer')
  if (isAdd.value) return preset.value?.name || 'a tool server'
  return words(toolName.value)
})
const logo = computed(() => (isApp.value ? appLogo(String(input.value.provider || '')) : isBrowser.value ? 'i-lucide-globe' : isSkill.value ? 'i-lucide-wand-sparkles' : isRun.value ? 'i-lucide-terminal' : isAdd.value ? (preset.value?.icon || 'i-lucide-plug') : mcpLogo(toolName.value)))
const kind = computed(() => isApp.value ? 'App action' : isMcp.value ? 'Tool from an outside server' : isBrowser.value ? 'Browser step' : isSkill.value ? 'Skill from GitHub' : isRun.value ? 'Run commands' : isAdd.value ? 'Add a tool server' : 'Action')

/** What will be done, in the person's own terms: the instruction for apps, the inputs for tools. */
const instruction = computed(() => props.instruction || (isApp.value ? String(input.value.instruction || '') : ''))
const fields = computed(() => isBrowser.value || isSkill.value || isRun.value || isAdd.value ? [] : Object.entries(input.value)
  .filter(([key]) => !(isApp.value && ['provider', 'instruction', 'access'].includes(key)))
  .map(([key, value]) => ({ key: words(key), value: (typeof value === 'string' ? value : JSON.stringify(value)) ?? '' })))

async function answer(approved: boolean) {
  if (answered.value !== null || !props.part.approval?.id) return
  answered.value = approved
  try {
    await respond?.(props.part.approval.id, approved)
  } catch {
    // The answer did not go through (connection lost, server refused it), so the buttons come back and it can be tried again.
    answered.value = null
  }
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
            {{ kind }} · <span class="text-default font-medium">{{ title }}</span>. {{ person ? 'Press Take over on the page, do it yourself, then press Continue.' : isSkill ? 'Instructions written by someone else. Loaded for this chat only, nothing is installed.' : isRun ? 'Only in the folder you chose. Nothing starts until you press Approve.' : isAdd ? 'Nothing is added until you press Approve.' : 'It may change things or reach other people.' }}
          </p>
        </div>
      </div>

      <template v-if="isAdd && preset">
        <p
          v-if="input.why"
          class="text-sm text-default"
        >
          {{ input.why }}
        </p>
        <div class="flex flex-col gap-2 rounded-xl bg-elevated/50 border border-default px-3.5 py-3 text-sm">
          <p class="text-default">
            {{ preset.summary }}
          </p>
          <p class="text-xs text-muted font-mono break-all">
            {{ presetHost }}
          </p>
          <span class="flex flex-wrap gap-1">
            <UBadge
              label="No sign-in needed"
              color="neutral"
              variant="subtle"
              size="sm"
            />
            <UBadge
              :label="preset.access === 'read' ? 'Only reads' : 'Can change things'"
              :color="preset.access === 'read' ? 'neutral' : 'warning'"
              variant="subtle"
              size="sm"
            />
          </span>
          <p
            v-if="preset.caution"
            class="text-xs text-muted"
          >
            {{ preset.caution }}
          </p>
        </div>
        <p class="text-xs text-muted">
          This only adds it. Nothing is switched on: you read each of its tools and choose which to allow afterwards.
        </p>
      </template>

      <template v-if="isRun">
        <p
          v-if="input.why"
          class="text-sm text-default"
        >
          {{ input.why }}
        </p>
        <ol class="flex flex-col gap-2.5 rounded-xl bg-elevated/50 border border-default px-3.5 py-3 text-sm">
          <li
            v-for="s in plan"
            :key="s.n"
            class="flex gap-2.5"
          >
            <span class="size-5 shrink-0 rounded-full bg-default border border-default text-xs text-muted flex items-center justify-center mt-0.5">{{ s.n }}</span>
            <span class="min-w-0 flex flex-col gap-0.5">
              <span class="text-default">{{ s.words }}</span>
              <span class="text-xs text-muted font-mono break-all">{{ s.command }}</span>
              <span
                v-if="s.why"
                class="text-xs text-muted"
              >{{ s.why }}</span>
              <span
                v-if="s.flags.length"
                class="flex flex-wrap gap-1 mt-0.5"
              >
                <UBadge
                  v-for="f in s.flags"
                  :key="f"
                  :label="f"
                  :color="f === 'Runs code' ? 'warning' : 'neutral'"
                  variant="subtle"
                  size="sm"
                />
              </span>
            </span>
          </li>
        </ol>
        <p class="text-xs text-muted">
          {{ anyRunsCode ? 'Programs you approve run with the same access as your own account, so only approve what you recognise.' : 'These steps only install and look. Packages are installed with their setup code switched off.' }} If a step fails, the rest do not run. You can stop everything from the stop button.
        </p>
      </template>

      <p
        v-if="instruction"
        class="text-sm text-default whitespace-pre-wrap break-words rounded-xl bg-elevated/50 border border-default px-3.5 py-2.5"
      >
        {{ instruction }}
      </p>

      <!-- Every input is listed, and a long value scrolls instead of being cut off: what is approved is what is shown. -->
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
          <dd class="text-default font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
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
