<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { useFileDownload } from '../../../composables/useFileDownload'
import { useWorkPane } from '../../../composables/useWorkPane'
import { accentGradient } from '../../../utils/accentGradient'

const props = defineProps<{
  invocation: any
}>()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output as { status?: string, fileId?: string, artifactId?: string, name?: string, format?: string, sizeKb?: number, expiresInDays?: number, error?: string } | undefined)
const failed = computed(() => !streaming.value && (!output.value || output.value.status === 'failed'))

const { loading, error, download } = useFileDownload(() => ({ fileId: output.value?.fileId, name: output.value?.name }))
const pane = useWorkPane()
const isOpen = computed(() => !!output.value?.artifactId && pane.openId.value === output.value.artifactId)
const toggle = () => (isOpen.value ? pane.close() : pane.open(output.value!.artifactId!))

const kind = computed(() => ({
  docx: { icon: 'i-lucide-file-type', label: 'Word document' },
  pdf: { icon: 'i-lucide-file-text', label: 'PDF document' },
  xlsx: { icon: 'i-lucide-file-spreadsheet', label: 'Excel spreadsheet' },
  pptx: { icon: 'i-lucide-presentation', label: 'PowerPoint presentation' }
}[output.value?.format ?? ''] ?? { icon: 'i-lucide-file', label: 'File' }))
</script>

<template>
  <UChatTool
    v-if="streaming || failed"
    :text="streaming ? 'Creating the file...' : 'Could not create the file'"
    :suffix="invocation.input?.title"
    :streaming="streaming"
    icon="i-lucide-file-plus"
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
    :class="['my-2 rounded-3xl p-3 max-w-md', accentGradient(output?.name ?? '')]"
  >
    <div class="flex items-center gap-3 rounded-2xl border border-default bg-default/80 backdrop-blur shadow-sm p-3.5">
      <div class="flex size-11 shrink-0 items-center justify-center rounded-xl border border-default bg-default shadow-sm">
        <UIcon
          :name="kind.icon"
          class="size-5 text-primary"
        />
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-highlighted">
          {{ output?.name }}
        </p>
        <p class="text-xs text-muted">
          {{ kind.label }} · {{ output?.sizeKb }} KB<template v-if="output?.expiresInDays"> · kept {{ output.expiresInDays }} days</template>
        </p>
        <p
          v-if="error"
          class="mt-1 text-xs text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </div>
      <UButton
        v-if="output?.artifactId"
        :icon="isOpen ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'"
        :label="isOpen ? 'Close' : 'Open'"
        color="neutral"
        size="sm"
        @click="toggle"
      />
      <UButton
        v-else
        icon="i-lucide-download"
        label="Download"
        color="neutral"
        variant="subtle"
        size="sm"
        :loading="loading"
        @click="download"
      />
    </div>
  </div>
</template>
