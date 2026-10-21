<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { useFileDownload } from '../../../composables/useFileDownload'

const props = defineProps<{
  invocation: any
}>()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output as { status?: string, fileId?: string, name?: string, format?: string, sizeKb?: number, expiresInDays?: number, error?: string } | undefined)
const failed = computed(() => !streaming.value && (!output.value || output.value.status === 'failed'))

const { loading, error, download } = useFileDownload(() => ({ fileId: output.value?.fileId, name: output.value?.name }))

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
    class="my-2 flex items-center gap-3 rounded-xl border border-default bg-elevated/50 p-3 max-w-md"
  >
    <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <UIcon
        :name="kind.icon"
        class="size-5"
      />
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-highlighted">
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
      icon="i-lucide-download"
      label="Download"
      color="primary"
      variant="soft"
      size="sm"
      :loading="loading"
      @click="download"
    />
  </div>
</template>
