<script setup lang="ts">
import { computed, inject, ref, toRef, useTemplateRef } from 'vue'
import { controlName, hostOf, stepText } from '../../../../shared/utils/browserSteps'
import { useBrowserView } from '../../../composables/useBrowserView'

/**
 * Everything the assistant does in a browser during one reply, as one card: the page live, what it is doing, a way to
 * take over (to sign in, solve a CAPTCHA or pay), and the question when a step needs your OK first.
 */
const props = defineProps<{
  /** Every browser step in this reply, in order. */
  parts: any[]
  chatId: string
  /** This is the reply in front of you, in a chat that is yours: only then is the page shown live. */
  live: boolean
  /** The assistant is working right now. */
  working: boolean
}>()

type Respond = (approvalId: string, approved: boolean) => void | Promise<void>
const respond = inject<Respond | null>('respondToToolApproval', null)

const outputOf = (p: any) => (p?.output && typeof p.output === 'object' ? p.output : null)
const controlsBefore = (i: number): string => {
  for (let j = i - 1; j >= 0; j--) { const c = outputOf(props.parts[j])?.controls; if (typeof c === 'string') return c }
  return ''
}
const lastOutput = computed(() => { for (let i = props.parts.length - 1; i >= 0; i--) { const o = outputOf(props.parts[i]); if (o?.url) return o } return null })

interface Step { id: string, text: string, state: 'running' | 'done' | 'failed' | 'declined' | 'asking', note?: string }
const steps = computed<Step[]>(() => props.parts.map((p, i) => {
  const text = stepText(p.input ?? {}, controlsBefore(i))
  const out = outputOf(p)
  const state: Step['state'] = p.state === 'output-denied' ? 'declined'
    : p.state === 'approval-requested' ? 'asking'
      : p.state === 'output-error' || out?.status === 'failed' ? 'failed'
        : p.state === 'output-available' ? 'done' : 'running'
  return { id: p.toolCallId ?? String(i), text, state, note: state === 'failed' ? String(out?.error ?? '').slice(0, 200) : undefined }
}))

const asking = computed(() => {
  const i = props.parts.findIndex(p => p.state === 'approval-requested')
  if (i < 0) return null
  const p = props.parts[i]
  const host = hostOf(lastOutput.value?.url ?? view.url.value)
  const named = p.input?.ref ? controlName(controlsBefore(i), p.input.ref) : null
  return { id: p.approval?.id as string | undefined, text: stepText(p.input ?? {}, controlsBefore(i)), host, named }
})
const answered = ref<boolean | null>(null)
async function answer(approved: boolean) {
  if (answered.value !== null || !asking.value?.id) return
  answered.value = approved
  await respond?.(asking.value.id, approved)
}

const chatId = toRef(props, 'chatId')
const busy = computed(() => props.working || steps.value.some(s => s.state === 'running'))
const view = useBrowserView(chatId, toRef(props, 'live'), busy)

const person = computed(() => view.control.value === 'person')
const status = computed(() => asking.value ? { label: 'Waiting for your OK', tone: 'bg-warning' }
  : person.value ? { label: 'You are in control', tone: 'bg-primary' }
    : view.ended.value && !busy.value ? { label: 'Finished', tone: 'bg-neutral-400' }
      : busy.value ? { label: 'Working', tone: 'bg-success animate-pulse' } : { label: 'Ready', tone: 'bg-success' })

const address = computed(() => view.url.value || lastOutput.value?.url || '')
const pageTitle = computed(() => view.title.value || lastOutput.value?.title || '')
const showAll = ref(false)
const shown = computed(() => (showAll.value ? steps.value : steps.value.slice(-4)))
const hidden = computed(() => steps.value.length - shown.value.length)

const screen = useTemplateRef<HTMLElement>('screen')
const typing = ref('')
const reveal = ref(false)
function sendTyped() { if (typing.value) { view.typeText(typing.value); typing.value = '' } }
function onKey(e: KeyboardEvent) { if (view.key(e)) e.preventDefault() }
function onWheel(e: WheelEvent) { if (person.value) { e.preventDefault(); view.scroll(e.deltaY) } }
function onPaste(e: ClipboardEvent) { if (person.value) { e.preventDefault(); view.typeText((e.clipboardData?.getData('text') ?? '').slice(0, 500)) } }
</script>

<template>
  <div
    class="my-2 rounded-3xl p-3 sm:p-4 min-w-0 max-w-full bg-gradient-to-b from-sky-400/15 to-violet-400/15 dark:from-sky-500/10 dark:to-violet-500/10"
    role="group"
    aria-label="Browser"
  >
    <div class="rounded-2xl border border-default bg-default/80 backdrop-blur shadow-sm overflow-hidden">
      <!-- The address bar: where the page is, and who has it. -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-default">
        <UIcon
          :name="address.startsWith('https:') ? 'i-lucide-lock' : 'i-lucide-globe'"
          class="size-3.5 text-muted shrink-0"
        />
        <div class="min-w-0 flex-1">
          <p class="text-xs text-highlighted truncate">
            {{ address ? hostOf(address) : 'Opening the browser…' }}
          </p>
          <p
            v-if="pageTitle"
            class="text-[11px] text-muted truncate"
          >
            {{ pageTitle }}
          </p>
        </div>
        <span class="inline-flex items-center gap-1.5 text-[11px] text-muted shrink-0">
          <span
            class="size-1.5 rounded-full"
            :class="status.tone"
          />{{ status.label }}
        </span>
      </div>

      <!-- The page. While you hold it, it answers to your clicks, typing and scrolling. -->
      <div
        ref="screen"
        class="relative bg-elevated aspect-[1100/700] w-full overflow-hidden outline-none"
        :class="person ? 'cursor-pointer ring-2 ring-inset ring-primary' : ''"
        :tabindex="person ? 0 : -1"
        @click="person && screen && view.click(screen, $event)"
        @keydown="onKey"
        @wheel="onWheel"
        @paste="onPaste"
      >
        <img
          v-if="view.image.value"
          :src="view.image.value"
          alt="The page the assistant is using"
          class="size-full object-contain select-none"
          draggable="false"
        >
        <div
          v-else
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted"
        >
          <UIcon
            :name="view.ended.value ? 'i-lucide-monitor-off' : 'i-lucide-globe'"
            class="size-6"
            :class="busy && !view.ended.value ? 'animate-pulse' : ''"
          />
          <p class="text-xs">
            {{ view.ended.value ? 'This browser session has ended.' : live ? 'Opening the browser…' : 'This page is no longer open.' }}
          </p>
        </div>
        <div
          v-if="view.image.value && view.ended.value"
          class="absolute inset-x-0 bottom-0 bg-default/85 backdrop-blur px-3 py-1.5 text-[11px] text-muted"
        >
          Session ended. This is the last thing it showed.
        </div>
      </div>

      <!-- Your hands: the banner, a typing box that works on a phone too, and the way back. -->
      <div
        v-if="person"
        class="px-3 py-3 border-t border-default bg-primary/5 flex flex-col gap-2.5"
      >
        <p class="text-xs text-default">
          <span class="font-medium">You are in control.</span> Click the page, then type. The assistant is waiting and cannot see what you type, so it is safe to enter a password or a code.
        </p>
        <div class="flex items-center gap-2">
          <UInput
            v-model="typing"
            :type="reveal ? 'text' : 'password'"
            autocomplete="off"
            placeholder="Type here to send to the page"
            size="sm"
            class="flex-1 min-w-0"
            @keydown.enter.prevent="sendTyped(); view.pressKey('Enter')"
          >
            <template #trailing>
              <UButton
                :icon="reveal ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                color="neutral"
                variant="link"
                size="xs"
                :aria-label="reveal ? 'Hide what I type' : 'Show what I type'"
                @click="reveal = !reveal"
              />
            </template>
          </UInput>
          <UButton
            label="Send"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="!typing"
            @click="sendTyped"
          />
          <UButton
            label="Tab"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="view.pressKey('Tab')"
          />
        </div>
        <div class="flex items-center justify-end gap-2">
          <UButton
            label="Stop browsing"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="view.close()"
          />
          <UButton
            label="Hand back"
            icon="i-lucide-check"
            color="neutral"
            size="sm"
            :loading="view.working.value"
            @click="view.handBack()"
          />
        </div>
      </div>

      <!-- A step that sends, buys or deletes: what it is, where, and two clear buttons. -->
      <div
        v-else-if="asking"
        class="px-3.5 py-3.5 border-t border-default flex flex-col gap-3"
      >
        <div class="flex items-start gap-3">
          <div class="size-9 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-shield-question"
              class="size-5 text-warning"
            />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-highlighted">
              Approve this before it runs
            </p>
            <p class="text-sm text-default mt-0.5 break-words">
              {{ asking.text }} <span class="text-muted">on {{ asking.host }}</span>
            </p>
            <p class="text-xs text-muted mt-1">
              It may send, buy, delete or change something there. Check the page above first.
            </p>
          </div>
        </div>
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

      <!-- What it has done so far. -->
      <div class="px-3.5 py-3 border-t border-default flex flex-col gap-1.5">
        <button
          v-if="hidden > 0 || showAll"
          type="button"
          class="self-start text-[11px] text-muted hover:text-default"
          @click="showAll = !showAll"
        >
          {{ showAll ? 'Show fewer steps' : `${hidden} earlier steps` }}
        </button>
        <ul class="flex flex-col gap-1">
          <li
            v-for="s in shown"
            :key="s.id"
            class="flex items-start gap-2 text-xs"
          >
            <UIcon
              :name="s.state === 'done' ? 'i-lucide-check' : s.state === 'failed' ? 'i-lucide-circle-alert' : s.state === 'declined' ? 'i-lucide-ban' : s.state === 'asking' ? 'i-lucide-hand' : 'i-lucide-loader-circle'"
              class="size-3.5 mt-0.5 shrink-0"
              :class="[s.state === 'done' ? 'text-success' : s.state === 'failed' ? 'text-error' : s.state === 'running' ? 'text-muted animate-spin' : 'text-warning']"
            />
            <span class="min-w-0 break-words">
              <span :class="s.state === 'running' ? 'text-highlighted' : 'text-default'">{{ s.text }}</span>
              <span
                v-if="s.state === 'declined'"
                class="text-muted"
              > · you declined, nothing was changed</span>
              <span
                v-if="s.note"
                class="block text-muted"
              >{{ s.note }}</span>
            </span>
          </li>
        </ul>
        <p
          v-if="view.error.value"
          class="text-xs text-error"
        >
          {{ view.error.value }}
        </p>
      </div>

      <div
        v-if="live && view.live.value && !person && !asking"
        class="flex items-center justify-end gap-2 px-3 pb-3 -mt-1"
      >
        <UButton
          label="Stop"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="view.close()"
        />
        <UButton
          label="Take over"
          icon="i-lucide-hand"
          color="neutral"
          variant="outline"
          size="xs"
          :loading="view.working.value"
          @click="view.takeOver()"
        />
      </div>
    </div>
  </div>
</template>
