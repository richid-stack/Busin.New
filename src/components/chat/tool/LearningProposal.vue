<script setup lang="ts">
import { computed, ref } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { $fetch } from 'ofetch'
import { useCsrf } from '../../../composables/useCsrf'
import { accentGradient } from '../../../utils/accentGradient'
import StatusChip from '../../tasks/StatusChip.vue'
import Person from '../../agents/Person.vue'
import { defaultPersonFor, isPersonId } from '../../../../shared/mascots'

// The assistant noticed a correction or a lasting preference and suggests keeping it. It is only a suggestion: the exact
// words are shown, and nothing is saved until the person presses the button. An agent's suggestion comes from that
// agent's own person (its mascot); a suggestion for memory comes from OpenLobs itself, shown as the mark.
const props = defineProps<{ part: any }>()
const { csrf, headerName } = useCsrf()

const streaming = computed(() => isToolStreaming(props.part))
const out = computed(() => (props.part.output && typeof props.part.output === 'object' ? props.part.output as Record<string, any> : null))
const proposed = computed(() => out.value?.status === 'proposed')
const forAgent = computed(() => out.value?.kind === 'agent')
const id = computed(() => String(props.part.toolCallId || ''))
const who = computed(() => (forAgent.value ? String(out.value?.agent?.name || 'This agent') : 'OpenLobs'))
const mascot = computed(() => {
  const given = out.value?.agent?.mascot
  return isPersonId(given) ? given : defaultPersonFor(who.value)
})

// A reload forgets component state, so what the person decided is kept on this device, by tool call.
type Decision = { state: 'saved' | 'skipped' | 'undone', savedId?: string, /** The old words of a replaced memory, to put back on undo. */ previous?: string, /** It was already there, so there is nothing to take back. */ existed?: boolean }
const KEY = 'openlobs.learning'
const read = (): Record<string, Decision> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const write = (value: Record<string, Decision>) => {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(value).slice(-200)))) } catch { /* private window */ }
}
const decided = ref<Decision | null>(read()[id.value] ?? null)
const remember = (value: Decision) => {
  decided.value = value
  write({ ...read(), [id.value]: value })
}

const saving = ref(false)
const undoing = ref(false)
const error = ref<string | null>(null)

const mood = computed(() => (decided.value?.state === 'saved' ? 'done' : decided.value ? 'idle' : 'asking'))
const off = computed(() => decided.value?.state === 'skipped' || decided.value?.state === 'undone')
const text = computed(() => {
  if (streaming.value) return 'Looking at what you said...'
  if (!proposed.value) return 'Nothing to keep'
  if (decided.value?.state === 'saved') return forAgent.value ? 'Added to instructions' : 'Added to memory'
  if (decided.value?.state === 'undone') return 'Removed again'
  if (decided.value?.state === 'skipped') return 'Skipped'
  return forAgent.value ? 'Suggested for this agent' : 'Suggested for memory'
})
const heading = computed(() => (decided.value?.state === 'saved' ? 'Kept for next time' : decided.value?.state === 'undone' ? 'Taken back' : decided.value?.state === 'skipped' ? 'Not this time' : 'Keep this for next time?'))
const suffix = computed(() => {
  const t = String(out.value?.text || props.part.input?.text || '')
  return t ? (t.length > 80 ? `${t.slice(0, 80)}…` : t) : undefined
})

async function save() {
  if (saving.value || !proposed.value) return
  saving.value = true
  error.value = null
  try {
    const res = await $fetch<{ id: string, previous?: string, existed?: boolean }>('/api/learning', {
      method: 'POST',
      headers: { [headerName]: csrf() },
      body: { kind: out.value!.kind, text: out.value!.text, replaces: out.value?.replaces?.id, agentId: out.value?.agent?.id }
    })
    remember({ state: 'saved', savedId: res.id, previous: res.previous, existed: res.existed })
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || 'Could not save that. Try again.'
  } finally { saving.value = false }
}

async function undo() {
  if (undoing.value || decided.value?.state !== 'saved') return
  undoing.value = true
  error.value = null
  try {
    await $fetch(`/api/learning/${decided.value.savedId}`, { method: 'DELETE', headers: { [headerName]: csrf() }, body: { kind: out.value!.kind, agentId: out.value?.agent?.id, text: out.value!.text, restore: decided.value.previous } })
    remember({ state: 'undone' })
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Could not undo. You can remove it yourself.'
  } finally { undoing.value = false }
}
</script>

<template>
  <UChatTool
    :text="text"
    :suffix="suffix"
    :streaming="streaming"
    icon="i-lucide-brain"
    chevron="leading"
    :default-open="proposed && !decided"
  >
    <div
      v-if="proposed"
      :class="['my-2 rounded-3xl p-3 sm:p-4 min-w-0 max-w-full', accentGradient(who)]"
    >
      <div class="rounded-2xl border border-default bg-default/80 backdrop-blur shadow-sm p-4 sm:p-5 flex flex-col gap-4">
        <div class="flex items-center gap-3.5">
          <div class="size-[72px] shrink-0 rounded-2xl border border-default bg-elevated/60 flex items-center justify-center">
            <Person
              v-if="forAgent"
              :id="mascot"
              :mood="mood"
              :size="60"
            />
            <svg
              v-else
              viewBox="0 0 100 118"
              class="h-10 text-highlighted"
              role="img"
              aria-label="OpenLobs"
              fill="currentColor"
            >
              <path d="M9,0 H54 A2,2 0 0 1 56.3,2 V40.3 A2,2 0 0 1 54.3,42.3 H2 A2,2 0 0 1 0,40.3 V9 A9,9 0 0 1 9,0 Z" />
              <path d="M0,51 C20,58 40.7,68 40.7,92 V100 H9 A9,9 0 0 1 0,91 Z" />
              <path d="M54.8,44.6 H98 A2,2 0 0 1 100,46.6 V90 A10,10 0 0 1 90,100 H48.9 Z" />
              <path
                d="M65.7,0 H88 A12,12 0 0 1 100,12 V30 A12,12 0 0 1 88,42 H65.7 A2,2 0 0 1 63.7,40 V2 A2,2 0 0 1 65.7,0 Z"
                opacity="0.14"
              />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-highlighted">
              {{ heading }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              {{ who }} noticed your correction
            </p>
          </div>
          <StatusChip
            :label="forAgent ? 'Agent' : 'Memory'"
            tone="quiet"
            class="self-start"
          />
        </div>

        <div class="flex flex-col gap-2.5 rounded-xl border border-default bg-elevated/50 px-4 py-3.5">
          <p class="font-mono text-[11px] uppercase tracking-wider text-dimmed">
            {{ out?.replaces ? 'Replaces' : forAgent ? 'Adds to its instructions' : 'Remember' }}
          </p>
          <p
            v-if="out?.replaces"
            class="text-sm leading-relaxed text-muted line-through decoration-dimmed/60"
          >
            {{ out.replaces.text }}
          </p>
          <p
            class="text-[15px] leading-relaxed"
            :class="off ? 'text-dimmed line-through' : 'text-highlighted'"
          >
            {{ out?.text }}
          </p>
        </div>

        <p
          v-if="out?.evidence"
          class="text-xs text-muted"
        >
          You said <span class="text-default">“{{ out.evidence }}”</span>
        </p>
        <p
          v-if="error"
          class="text-xs text-error"
          role="alert"
        >
          {{ error }}
        </p>

        <div
          v-if="!decided"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-default pt-4"
        >
          <UButton
            :label="forAgent ? 'Add to instructions' : 'Save to memory'"
            color="neutral"
            :loading="saving"
            @click="save"
          />
          <UButton
            label="Not now"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="remember({ state: 'skipped' })"
          />
          <span class="ml-auto text-xs text-dimmed">{{ forAgent ? 'Only this agent. Undo any time.' : 'Every chat. Undo any time.' }}</span>
        </div>
        <p
          v-else
          class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-default pt-3 text-xs text-muted"
        >
          <button
            v-if="decided.state === 'saved' && !decided.existed"
            type="button"
            class="underline underline-offset-2 hover:text-highlighted disabled:opacity-60"
            :disabled="undoing"
            @click="undo"
          >
            Undo
          </button>
          <RouterLink
            v-if="decided.state === 'saved'"
            :to="forAgent ? '/agents' : '/memory'"
            class="underline underline-offset-2 hover:text-highlighted"
          >
            {{ forAgent ? 'Open agents' : 'Manage memory' }}
          </RouterLink>
          <button
            v-if="decided.state === 'skipped'"
            type="button"
            class="underline underline-offset-2 hover:text-highlighted"
            @click="decided = null"
          >
            Review again
          </button>
        </p>
      </div>
    </div>
    <p
      v-else-if="out?.error"
      class="text-xs text-error"
    >
      {{ out.error }}
    </p>
  </UChatTool>
</template>
