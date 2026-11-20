<script setup lang="ts">
import { computed, ref } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { $fetch } from 'ofetch'
import { useCsrf } from '../../../composables/useCsrf'
import StatusChip from '../../tasks/StatusChip.vue'

// The assistant noticed a correction or a lasting preference and suggests keeping it. It is only a suggestion: the exact
// words are shown, and nothing is saved until the person presses the button.
const props = defineProps<{ part: any }>()
const { csrf, headerName } = useCsrf()

const streaming = computed(() => isToolStreaming(props.part))
const out = computed(() => (props.part.output && typeof props.part.output === 'object' ? props.part.output as Record<string, any> : null))
const proposed = computed(() => out.value?.status === 'proposed')
const forAgent = computed(() => out.value?.kind === 'agent')
const id = computed(() => String(props.part.toolCallId || ''))

// A reload forgets component state, so what the person decided is kept on this device, by tool call.
const KEY = 'openlobs.learning'
const read = (): Record<string, any> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const write = (value: Record<string, any>) => {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(value).slice(-200)))) } catch { /* private window */ }
}
const decided = ref<{ state: 'saved' | 'skipped' | 'undone', savedId?: string } | null>(read()[id.value] ?? null)
const remember = (value: { state: 'saved' | 'skipped' | 'undone', savedId?: string }) => {
  decided.value = value
  write({ ...read(), [id.value]: value })
}

const saving = ref(false)
const undoing = ref(false)
const error = ref<string | null>(null)

const where = computed(() => (forAgent.value ? `${out.value?.agent?.name || 'this agent'}` : 'memory'))
const text = computed(() => {
  if (streaming.value) return 'Looking at what you said...'
  if (!proposed.value) return 'Nothing to keep'
  if (decided.value?.state === 'saved') return forAgent.value ? 'Added to instructions' : 'Added to memory'
  if (decided.value?.state === 'undone') return 'Removed again'
  if (decided.value?.state === 'skipped') return 'Skipped'
  return forAgent.value ? 'Suggested for this agent' : 'Suggested for memory'
})
const suffix = computed(() => {
  const t = String(out.value?.text || props.part.input?.text || '')
  return t ? (t.length > 80 ? `${t.slice(0, 80)}…` : t) : undefined
})

async function save() {
  if (saving.value || !proposed.value) return
  saving.value = true
  error.value = null
  try {
    const res = await $fetch<{ id: string }>('/api/learning', {
      method: 'POST',
      headers: { [headerName]: csrf() },
      body: { kind: out.value!.kind, text: out.value!.text, replaces: out.value?.replaces?.id, agentId: out.value?.agent?.id }
    })
    remember({ state: 'saved', savedId: res.id })
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || 'Could not save that. Try again.'
  } finally { saving.value = false }
}

async function undo() {
  if (undoing.value || decided.value?.state !== 'saved') return
  undoing.value = true
  error.value = null
  try {
    await $fetch(`/api/learning/${decided.value.savedId}`, { method: 'DELETE', headers: { [headerName]: csrf() }, body: { kind: out.value!.kind, agentId: out.value?.agent?.id } })
    remember({ state: 'undone' })
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Could not undo. You can remove it yourself.'
  } finally { undoing.value = false }
}
</script>

<template>
  <UChatTool :text="text" :suffix="suffix" :streaming="streaming" icon="i-lucide-brain" chevron="leading" :default-open="proposed && !decided">
    <div v-if="proposed" class="space-y-3 text-sm">
      <div class="flex items-center gap-2">
        <StatusChip :label="forAgent ? 'Agent' : 'Memory'" tone="quiet" />
        <span class="text-xs text-muted">
          {{ forAgent ? `Adds one line to the instructions of ${where}` : 'Kept for every chat from now on' }}
        </span>
      </div>

      <div v-if="out?.replaces" class="border-l border-default pl-3">
        <p class="text-[11px] font-mono uppercase tracking-wider text-dimmed">Replaces</p>
        <p class="text-sm leading-relaxed text-muted line-through decoration-dimmed/60">{{ out.replaces.text }}</p>
      </div>
      <div class="border-l pl-3" :class="decided?.state === 'skipped' || decided?.state === 'undone' ? 'border-default' : 'border-inverted'">
        <p class="text-[11px] font-mono uppercase tracking-wider text-dimmed">{{ out?.replaces ? 'With' : forAgent ? 'Adds' : 'Remember' }}</p>
        <p class="text-sm leading-relaxed" :class="decided?.state === 'skipped' || decided?.state === 'undone' ? 'text-dimmed line-through' : 'text-highlighted'">{{ out?.text }}</p>
      </div>
      <p v-if="out?.evidence" class="text-xs text-muted">You said: <span class="text-default">“{{ out.evidence }}”</span></p>

      <p v-if="error" class="text-xs text-error" role="alert">{{ error }}</p>

      <div v-if="!decided" class="flex flex-wrap items-center gap-2 border-t border-default pt-3">
        <UButton :label="forAgent ? 'Add to instructions' : 'Save to memory'" size="sm" color="neutral" :loading="saving" @click="save" />
        <UButton label="Not now" size="sm" color="neutral" variant="ghost" :disabled="saving" @click="remember({ state: 'skipped' })" />
      </div>
      <p v-else class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <button v-if="decided.state === 'saved'" type="button" class="underline underline-offset-2 hover:text-highlighted disabled:opacity-60" :disabled="undoing" @click="undo">Undo</button>
        <RouterLink v-if="decided.state === 'saved'" :to="forAgent ? '/agents' : '/memory'" class="underline underline-offset-2 hover:text-highlighted">
          {{ forAgent ? 'Open agents' : 'Manage memory' }}
        </RouterLink>
        <button v-if="decided.state === 'skipped'" type="button" class="underline underline-offset-2 hover:text-highlighted" @click="decided = null">Review again</button>
      </p>
    </div>
    <p v-else-if="out?.error" class="text-xs text-error">{{ out.error }}</p>
  </UChatTool>
</template>
