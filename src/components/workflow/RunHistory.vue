<script setup lang="ts">
import { STATUS_META } from '../../utils/workflowGraph'

const open = defineModel<boolean>('open', { default: false })

defineProps<{
  runs: any[]
  loading: boolean
}>()

const emit = defineEmits<{
  select: [run: any]
  refresh: []
}>()

function textClass(status: string) {
  return { success: 'text-success', error: 'text-error', warning: 'text-warning', info: 'text-primary', neutral: 'text-muted' }[STATUS_META[status]?.color ?? 'neutral']
}

function when(value: string | number | Date) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Execution history"
    description="Past runs of this workflow, including webhook calls."
  >
    <template #body>
      <div class="h-full flex flex-col">
        <div class="flex justify-end mb-3">
          <UButton
            label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="loading"
            @click="emit('refresh')"
          />
        </div>

        <div v-if="loading && runs.length === 0" class="flex items-center justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="size-6 text-muted animate-spin" />
        </div>

        <div v-else-if="runs.length === 0" class="text-center py-12">
          <UIcon name="i-lucide-activity" class="size-10 text-muted/50 mx-auto mb-3" />
          <h3 class="text-sm font-medium text-highlighted">No runs yet</h3>
          <p class="text-xs text-muted mt-1">Use Test Run, or deploy the workflow and call its webhook.</p>
        </div>

        <div v-else class="space-y-3 overflow-y-auto pr-1">
          <button
            v-for="run in runs"
            :key="run.id"
            type="button"
            class="w-full text-left border border-default bg-elevated rounded-lg p-4 hover:border-primary/50 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
            @click="emit('select', run)"
          >
            <div class="flex items-center justify-between mb-3 gap-3">
              <div class="flex items-center gap-2" :class="textClass(run.status)">
                <UIcon :name="STATUS_META[run.status]?.icon ?? 'i-lucide-circle'" class="size-4" />
                <span class="text-sm font-semibold">{{ STATUS_META[run.status]?.label ?? run.status }}</span>
              </div>
              <span class="text-xs text-muted">{{ when(run.createdAt) }}</span>
            </div>

            <div class="flex items-center justify-between text-xs text-muted" :class="{ 'mb-3 pb-3 border-b border-default': run.logs?.length }">
              <span>Duration <span class="font-mono text-default">{{ run.durationMs ?? 0 }}ms</span></span>
              <span>ID <span class="font-mono text-default">{{ String(run.id).slice(-6) }}</span></span>
            </div>

            <div v-if="run.logs?.length" class="space-y-1.5">
              <div v-for="(log, index) in run.logs.slice(0, 3)" :key="`${log.nodeId}-${index}`" class="flex items-center gap-2 text-xs">
                <UIcon
                  :name="STATUS_META[log.status]?.icon ?? 'i-lucide-circle'"
                  class="size-3 shrink-0"
                  :class="textClass(log.status)"
                />
                <span class="font-medium text-default truncate w-24 shrink-0">{{ log.nodeTitle }}</span>
                <span class="text-muted truncate flex-1">{{ log.message }}</span>
              </div>
              <p v-if="run.logs.length > 3" class="text-xs text-primary font-medium pl-5">
                + {{ run.logs.length - 3 }} more {{ run.logs.length - 3 === 1 ? 'step' : 'steps' }}
              </p>
            </div>
          </button>
        </div>
      </div>
    </template>
  </USlideover>
</template>
