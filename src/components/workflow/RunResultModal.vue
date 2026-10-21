<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { STATUS_META } from '../../utils/workflowGraph'
import { useWorkflowApproval } from '../../composables/useWorkflowApproval'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  workflowId: string
  executing: boolean
  run: any | null
  error: string | null
}>()

const emit = defineEmits<{
  'run-updated': [run: any]
}>()

const comments = ref('')
const { loading, result, updatedRun, submit } = useWorkflowApproval(() => ({
  workflowId: props.workflowId,
  runId: props.run?.id
}))

watch(() => props.run?.id, () => {
  comments.value = ''
  result.value = null
})

watch(updatedRun, (run) => {
  if (run) emit('run-updated', run)
})

const status = computed<string>(() => props.run?.status ?? 'completed')
const meta = computed(() => STATUS_META[status.value] ?? STATUS_META.completed!)
const awaitingDecision = computed(() => status.value === 'waiting_approval' && result.value === null)

const headline = computed(() => {
  switch (status.value) {
    case 'completed': return 'Run completed'
    case 'failed': return 'Run failed'
    case 'waiting_approval': return 'Waiting for your approval'
    case 'rejected': return 'Run rejected'
    default: return 'Run finished'
  }
})

function logColor(logStatus: string) {
  return (STATUS_META[logStatus]?.color ?? 'neutral')
}
function textClass(color: string) {
  return { success: 'text-success', error: 'text-error', warning: 'text-warning', info: 'text-primary', neutral: 'text-muted' }[color]
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Test run"
    description="What each step did, in order."
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="executing"
          color="info"
          variant="subtle"
          icon="i-lucide-loader-2"
          title="Running your workflow"
          description="Steps run in order. AI and app steps can take a little while."
          :ui="{ icon: 'animate-spin' }"
        />

        <UAlert
          v-else-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="The run could not start"
          :description="error"
        />

        <template v-else-if="run">
          <div
            class="p-3 rounded-lg border flex items-center justify-between text-sm"
            :class="{
              'bg-success/10 border-success/20': meta.color === 'success',
              'bg-error/10 border-error/20': meta.color === 'error',
              'bg-warning/10 border-warning/20': meta.color === 'warning'
            }"
          >
            <div class="flex items-center gap-2" :class="textClass(meta.color)">
              <UIcon :name="meta.icon" class="size-5 shrink-0" />
              <span class="font-medium">{{ headline }}</span>
            </div>
            <span v-if="run.durationMs" class="text-xs font-mono text-muted">{{ run.durationMs }}ms</span>
          </div>

          <!-- Human approval -->
          <div
            v-if="status === 'waiting_approval' || result"
            class="p-4 rounded-xl border border-default bg-elevated/50 space-y-3"
          >
            <template v-if="awaitingDecision">
              <p class="text-sm text-default">{{ run.approvalPrompt || 'This run needs your sign-off to continue.' }}</p>
              <UTextarea v-model="comments" placeholder="Add a comment (optional)" :rows="2" class="w-full" />
              <div class="flex items-center gap-2">
                <UButton
                  label="Approve"
                  icon="i-lucide-check"
                  color="success"
                  :loading="loading === 'approve'"
                  :disabled="loading !== null"
                  @click="submit(true, comments)"
                />
                <UButton
                  label="Reject"
                  icon="i-lucide-x"
                  color="error"
                  variant="subtle"
                  :loading="loading === 'reject'"
                  :disabled="loading !== null"
                  @click="submit(false, comments)"
                />
              </div>
            </template>
            <p v-else class="text-sm text-default flex items-center gap-2">
              <UIcon
                :name="result === 'rejected' ? 'i-lucide-ban' : 'i-lucide-circle-check'"
                class="size-4"
                :class="result === 'rejected' ? 'text-error' : 'text-success'"
              />
              {{
                result === 'approved' ? 'Approved. The workflow continued.'
                : result === 'rejected' ? 'Rejected. The workflow stopped.'
                : 'This request was already answered.'
              }}
            </p>
          </div>

          <div v-if="run.logs?.length" class="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
            <div
              v-for="(log, index) in run.logs"
              :key="`${log.nodeId}-${index}`"
              class="p-3 rounded-lg border border-default bg-elevated/50 flex flex-col gap-2 text-xs"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 min-w-0">
                  <UIcon
                    :name="STATUS_META[log.status]?.icon ?? 'i-lucide-circle'"
                    class="size-3.5 shrink-0"
                    :class="textClass(logColor(log.status))"
                  />
                  <span class="font-semibold text-default truncate">{{ log.nodeTitle }}</span>
                  <UBadge :label="log.type" color="neutral" variant="subtle" size="sm" class="uppercase font-mono text-[10px]" />
                </div>
                <span class="font-mono text-muted text-[11px] shrink-0">{{ log.durationMs }}ms</span>
              </div>

              <p v-if="log.message" class="text-muted text-[11px]">{{ log.message }}</p>

              <div
                v-if="log.status === 'auth_required'"
                class="p-2 rounded bg-warning/10 border border-warning/20 flex items-center justify-between gap-2"
              >
                <span class="text-warning font-medium">Connect this app to finish the step</span>
                <UButton
                  v-if="log.authUrl"
                  label="Authorize"
                  color="warning"
                  size="xs"
                  :to="log.authUrl"
                  target="_blank"
                />
              </div>

              <pre
                v-if="log.output != null"
                class="rounded p-2 border border-default bg-default font-mono text-[10px] text-muted overflow-auto max-h-28"
              >{{ JSON.stringify(log.output, null, 2) }}</pre>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <span class="text-xs text-muted">Every run is saved to Execution history.</span>
        <UButton label="Close" color="neutral" variant="subtle" size="sm" @click="open = false" />
      </div>
    </template>
  </UModal>
</template>
