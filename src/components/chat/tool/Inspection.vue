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
  pass: { label: 'Looks right', icon: 'i-lucide-circle-check', tone: 'text-success' },
  fail: { label: 'Needs fixes', icon: 'i-lucide-circle-alert', tone: 'text-error' },
  unsure: { label: 'Not sure', icon: 'i-lucide-circle-help', tone: 'text-warning' }
} as const
const verdict = computed(() => VERDICTS[output.value?.verdict ?? 'unsure'])

const SEVERITY = {
  blocker: { label: 'Blocker', dot: 'bg-error' },
  major: { label: 'Major', dot: 'bg-warning' },
  minor: { label: 'Minor', dot: 'bg-neutral-400' }
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
const showImage = ref(false)
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
    class="my-2 max-w-xl rounded-xl border border-default"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 px-4 py-3 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <UIcon
        :name="verdict.icon"
        class="size-5 shrink-0"
        :class="verdict.tone"
      />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-highlighted">
          {{ verdict.label }}<span class="font-normal text-muted"> · {{ output?.score }}/100</span>
        </span>
        <span
          v-if="output?.source"
          class="block truncate text-xs text-muted"
        >{{ output.source }}</span>
      </span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 shrink-0 text-muted transition-transform"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <div
      v-if="open"
      class="border-t border-default px-4 py-3"
    >
      <p class="text-sm text-default">
        {{ output?.summary }}
      </p>
      <p
        v-if="output?.progressNote"
        class="mt-1 text-xs text-muted"
      >
        {{ output.progressNote }}
      </p>

      <ul
        v-if="output?.defects?.length"
        class="mt-3 divide-y divide-default"
      >
        <li
          v-for="d in output.defects"
          :key="d.id"
          class="flex gap-2.5 py-2.5 first:pt-0 last:pb-0"
        >
          <span
            class="mt-1.5 size-2 shrink-0 rounded-full"
            :class="SEVERITY[d.severity]?.dot"
            :title="SEVERITY[d.severity]?.label"
          />
          <div class="min-w-0 text-sm">
            <p class="text-default">
              <span class="font-medium text-highlighted">{{ d.area }}.</span> {{ d.problem }}
              <span class="sr-only"> ({{ SEVERITY[d.severity]?.label }})</span>
            </p>
            <p class="mt-0.5 text-xs text-muted">
              {{ d.fix }}
            </p>
          </div>
        </li>
      </ul>
      <p
        v-else
        class="mt-3 text-xs text-muted"
      >
        No problems found against the requirements.
      </p>

      <template v-if="imageUrl">
        <button
          type="button"
          class="mt-3 text-xs text-muted hover:text-default"
          @click="showImage = !showImage"
        >
          {{ showImage ? 'Hide screenshot' : 'Show screenshot' }}
        </button>
        <img
          v-if="showImage"
          :src="imageUrl"
          alt="Screenshot that was checked"
          class="mt-2 max-h-64 w-full rounded-lg object-cover object-top ring-1 ring-default"
        >
      </template>
      <p
        v-else-if="imageFailed"
        class="mt-3 text-xs text-muted"
      >
        The screenshot is no longer available.
      </p>
    </div>
  </div>
</template>
