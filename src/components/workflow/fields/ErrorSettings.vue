<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  settings?: { retries?: number, retryDelaySec?: number, onError?: 'stop' | 'continue' | 'route' }
  /** Whether repeating this kind of step is possible at all. */
  canRetry: boolean
  retryNote?: string
}>()
const emit = defineEmits<{ update: [settings: Record<string, any>] }>()

const retries = computed(() => props.settings?.retries ?? 0)
const onError = computed(() => props.settings?.onError ?? 'stop')

const RETRY_ITEMS = [
  { label: 'Do not retry', value: 0 },
  { label: 'Retry once', value: 1 },
  { label: 'Retry twice', value: 2 },
  { label: 'Retry 3 times', value: 3 }
]
const ERROR_ITEMS = [
  { label: 'Stop the workflow', value: 'stop' },
  { label: 'Carry on with the error', value: 'continue' },
  { label: 'Follow the red error connector', value: 'route' }
]
const ERROR_HELP: Record<string, string> = {
  stop: 'The run is marked as failed and later steps do not run.',
  continue: 'Later steps run. They can read the message as {{this-step.error}}.',
  route: 'Drag a connection from the red ERROR dot on this step to the step that should handle the failure. The run counts as completed when that path finishes.'
}

function patch(change: Record<string, any>) {
  emit('update', { ...props.settings, ...change })
}
</script>

<template>
  <div class="space-y-3 pt-4 border-t border-default">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-life-buoy" class="size-4 text-muted" />
      <span class="text-xs font-semibold text-default uppercase tracking-wide">If this step fails</span>
    </div>

    <template v-if="canRetry">
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Retries" size="sm">
          <USelect
            :model-value="retries"
            :items="RETRY_ITEMS"
            size="md"
            class="w-full"
            @update:model-value="patch({ retries: $event })"
          />
        </UFormField>
        <UFormField v-if="retries > 0" label="First wait (seconds)" size="sm" help="Doubles each time.">
          <UInput
            :model-value="settings?.retryDelaySec ?? 2"
            type="number"
            :min="1"
            :max="30"
            size="sm"
            class="w-full"
            @update:model-value="patch({ retryDelaySec: Math.min(30, Math.max(1, Number($event) || 2)) })"
          />
        </UFormField>
      </div>
      <p v-if="retries > 0" class="text-[11px] text-muted">
        Only retry steps that are safe to repeat. A step that sends a message or creates a record could do it twice. Setup mistakes, such as a bad address, are never retried.
      </p>
    </template>
    <p v-else-if="retryNote" class="text-[11px] text-muted">{{ retryNote }}</p>

    <UFormField label="When it still fails" size="sm" :help="ERROR_HELP[onError]">
      <USelect
        :model-value="onError"
        :items="ERROR_ITEMS"
        size="md"
        class="w-full"
        @update:model-value="patch({ onError: $event })"
      />
    </UFormField>
  </div>
</template>
