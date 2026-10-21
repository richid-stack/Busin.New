<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'

type Defect = { id: string, severity: 'blocker' | 'major' | 'minor', area: string, problem: string, fix: string }
type Output = {
  status?: string
  verdict?: 'pass' | 'fail' | 'unsure'
  score?: number
  summary?: string
  defects?: Defect[]
  progress?: Array<{ id: string, status: string, note: string }>
  progressNote?: string
  source?: string
  screenshotFileId?: string | null
  error?: string
}

const props = defineProps<{ invocation: any }>()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output as Output | undefined)
const failed = computed(() => !streaming.value && (!output.value || output.value.status === 'failed'))

const VERDICTS = {
  pass: { label: 'Looks right', icon: 'i-lucide-circle-check', tone: 'text-success bg-success/10 ring-success/25' },
  fail: { label: 'Needs fixes', icon: 'i-lucide-circle-alert', tone: 'text-error bg-error/10 ring-error/25' },
  unsure: { label: 'Not sure', icon: 'i-lucide-circle-help', tone: 'text-warning bg-warning/10 ring-warning/25' }
} as const
const verdict = computed(() => VERDICTS[output.value?.verdict ?? 'unsure'])

const SEVERITY = {
  blocker: { label: 'Blocker', tone: 'text-error bg-error/10' },
  major: { label: 'Major', tone: 'text-warning bg-warning/10' },
  minor: { label: 'Minor', tone: 'text-muted bg-elevated' }
} as const

// The saved screenshot needs the sign-in token, so it is fetched and shown from a local copy.
const imageUrl = ref('')
const imageFailed = ref(false)
let objectUrl = ''
watch(() => output.value?.screenshotFileId, async (id) => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  imageUrl.value = ''
  imageFailed.value = false
  if (!id) return
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error('missing')
    objectUrl = URL.createObjectURL(await res.blob())
    imageUrl.value = objectUrl
  } catch {
    imageFailed.value = true
  }
}, { immediate: true })
onBeforeUnmount(() => { if (objectUrl) URL.revokeObjectURL(objectUrl) })

const open = ref(true)
</script>

<template>
  <UChatTool
    v-if="streaming || failed"
    :text="streaming ? 'Looking at the page...' : 'Could not check the design'"
    :suffix="invocation.input?.url"
    :streaming="streaming"
    icon="i-lucide-scan-eye"
    chevron="leading"
  >
    <p
      v-if="failed && output?.error"
      class="text-sm text-muted"
    >
      {{ output.error }}
    </p>
  </UChatTool>

  <div
    v-else
    class="my-2 max-w-xl overflow-hidden rounded-xl border border-default bg-elevated/50"
  >
    <div class="flex items-center gap-3 p-3">
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset"
        :class="verdict.tone"
      >
        <UIcon
          :name="verdict.icon"
          class="size-5"
        />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-highlighted">
          {{ verdict.label }}<span class="text-muted font-normal"> · {{ output?.score }}/100</span>
        </p>
        <p
          v-if="output?.source"
          class="truncate text-xs text-muted"
        >
          {{ output.source }}
        </p>
      </div>
      <UButton
        :icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="open ? 'Hide details' : 'Show details'"
        :aria-expanded="open"
        @click="open = !open"
      />
    </div>

    <div
      v-if="open"
      class="space-y-3 border-t border-default p-3"
    >
      <p class="text-sm text-default">
        {{ output?.summary }}
      </p>

      <img
        v-if="imageUrl"
        :src="imageUrl"
        alt="Screenshot that was checked"
        class="max-h-72 w-full rounded-lg border border-default object-cover object-top"
      >
      <p
        v-else-if="imageFailed"
        class="text-xs text-muted"
      >
        The screenshot is no longer available.
      </p>

      <p
        v-if="output?.progressNote"
        class="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary"
      >
        {{ output.progressNote }}
      </p>

      <ul
        v-if="output?.defects?.length"
        class="space-y-2"
      >
        <li
          v-for="d in output.defects"
          :key="d.id"
          class="rounded-lg border border-default bg-default p-2.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
              :class="SEVERITY[d.severity]?.tone"
            >{{ SEVERITY[d.severity]?.label }}</span>
            <span class="text-xs text-muted">{{ d.area }}</span>
          </div>
          <p class="mt-1 text-sm text-default">
            {{ d.problem }}
          </p>
          <p class="mt-1 text-xs text-muted">
            <span class="font-medium text-default">Fix:</span> {{ d.fix }}
          </p>
        </li>
      </ul>
      <p
        v-else
        class="text-xs text-muted"
      >
        No problems were found against the requirements.
      </p>

      <p
        v-if="output?.progress?.length"
        class="text-xs text-muted"
      >
        Earlier problems:
        <template
          v-for="(p, i) in output.progress"
          :key="p.id"
        ><span v-if="i">, </span>{{ p.id }} {{ p.status === 'fixed' ? 'fixed' : p.status === 'still_present' ? 'still there' : 'unclear' }}</template>
      </p>
    </div>
  </div>
</template>
