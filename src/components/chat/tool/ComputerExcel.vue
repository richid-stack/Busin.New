<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'

type Check = { name: string, ok: boolean, detail: string }
const props = defineProps<{ invocation: any }>()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output as { status?: string, error?: string, computer?: string, output?: string, steps?: string[], checks?: Check[], warnings?: string[], errors?: string[], charts?: number, pdf?: string | null, files?: unknown[], sheets?: unknown[] } | undefined)
const action = computed<string>(() => props.invocation.input?.action ?? 'list')
const failed = computed(() => !streaming.value && (!output.value || output.value.status === 'failed'))

const text = computed(() => {
  if (streaming.value) return action.value === 'apply' ? 'Working on the spreadsheet...' : action.value === 'inspect' ? 'Reading the spreadsheet...' : 'Looking in your folder...'
  if (failed.value) return action.value === 'apply' ? 'Could not change the spreadsheet' : 'Could not reach your spreadsheets'
  if (action.value === 'apply') return `Saved ${output.value?.output}`
  if (action.value === 'inspect') return 'Read the spreadsheet'
  return 'Looked in your folder'
})
const problems = computed(() => (output.value?.checks ?? []).filter(c => !c.ok).length)
</script>

<template>
  <UChatTool
    :text="text"
    :suffix="output?.computer ? `on ${output.computer}` : props.invocation.input?.file"
    :streaming="streaming"
    icon="i-lucide-file-spreadsheet"
    chevron="leading"
  >
    <p
      v-if="failed"
      class="text-sm text-muted"
    >
      {{ output?.error || 'The computer did not answer.' }}
    </p>
    <div
      v-else-if="action === 'apply'"
      class="space-y-3 text-sm"
    >
      <ul class="space-y-1 text-muted">
        <li
          v-for="s in output?.steps ?? []"
          :key="s"
        >
          {{ s }}
        </li>
      </ul>
      <ul class="space-y-1">
        <li
          v-for="c in output?.checks ?? []"
          :key="c.name"
          class="flex items-start gap-2"
        >
          <UIcon
            :name="c.ok ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
            :class="c.ok ? 'text-success' : 'text-warning'"
            class="mt-0.5 size-4 shrink-0"
          />
          <span><span class="text-highlighted">{{ c.name }}</span><span class="text-muted"> · {{ c.detail }}</span></span>
        </li>
      </ul>
      <p
        v-for="w in output?.warnings ?? []"
        :key="w"
        class="text-xs text-warning"
      >
        {{ w }}
      </p>
      <p
        v-if="problems"
        class="text-xs text-warning"
      >
        Some checks did not pass. The file is saved, but look at it before you rely on it.
      </p>
      <p
        v-if="output?.pdf"
        class="text-xs text-muted"
      >
        Also saved a PDF: {{ output.pdf }}
      </p>
    </div>
  </UChatTool>
</template>
