<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { useWorkflowApproval } from '../../../composables/useWorkflowApproval'

const props = defineProps<{
  invocation: any
}>()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output)

interface Step { nodeId: string, title: string, status: string, message?: string, authUrl?: string }
const steps = computed<Step[]>(() => output.value?.steps ?? [])

const { loading: isLoading, result: approvalResult, submit } = useWorkflowApproval(() => ({
  workflowId: output.value?.workflowId,
  runId: output.value?.runId
}))

const state = computed<'running' | 'waiting' | 'completed' | 'rejected' | 'failed'>(() => {
  if (streaming.value || !output.value) return 'running'
  if (output.value.status === 'waiting_approval') return 'waiting'
  if (output.value.status === 'completed') return 'completed'
  if (output.value.status === 'rejected') return 'rejected'
  return 'failed'
})

const heading = computed(() => ({
  running: 'Running workflow...',
  waiting: 'Workflow waiting for approval',
  completed: 'Workflow completed',
  rejected: 'Workflow rejected',
  failed: 'Workflow failed'
}[state.value]))

const stepIcon = (status: string) => ({
  completed: 'i-lucide-check-circle-2',
  failed: 'i-lucide-x-circle',
  auth_required: 'i-lucide-key-round',
  skipped: 'i-lucide-skip-forward',
  waiting: 'i-lucide-hourglass'
}[status] || 'i-lucide-circle')

const stepColor = (status: string) => ({
  completed: 'text-success',
  failed: 'text-error',
  auth_required: 'text-warning',
  waiting: 'text-warning'
}[status] || 'text-muted')

const hasOutputs = computed(() => output.value?.outputs && Object.keys(output.value.outputs).length > 0)
</script>

<template>
  <UChatTool
    :text="heading"
    :suffix="output?.title || invocation.input?.workflowId"
    :streaming="state === 'running'"
    icon="i-lucide-play-circle"
    chevron="leading"
    :default-open="state === 'waiting'"
  >
    <div
      v-if="state === 'waiting'"
      class="p-4 border border-warning/25 bg-warning/5 rounded-xl flex flex-col gap-3"
    >
      <div class="flex items-start gap-3">
        <div class="p-2.5 bg-warning/10 rounded-lg text-warning mt-0.5">
          <UIcon
            name="i-lucide-shield-question"
            class="size-5"
          />
        </div>
        <div class="min-w-0">
          <h4 class="font-semibold text-highlighted text-sm">
            {{ output.title || 'Workflow paused for approval' }}
          </h4>
          <p class="text-xs text-muted mt-1 whitespace-pre-wrap">
            {{ output.approvalPrompt || 'This workflow needs a person to review it before it continues.' }}
          </p>
        </div>
      </div>

      <div
        v-if="!approvalResult"
        class="flex items-center gap-2 mt-1"
      >
        <UButton
          color="success"
          icon="i-lucide-check"
          label="Approve & continue"
          size="sm"
          :loading="isLoading === 'approve'"
          :disabled="isLoading !== null"
          @click="submit(true, 'Approved from chat')"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-x"
          label="Reject"
          size="sm"
          :loading="isLoading === 'reject'"
          :disabled="isLoading !== null"
          @click="submit(false, 'Rejected from chat')"
        />
      </div>
      <p
        v-else
        class="text-xs font-medium"
        :class="approvalResult === 'approved' ? 'text-success' : approvalResult === 'rejected' ? 'text-error' : 'text-muted'"
      >
        {{ approvalResult === 'approved' ? 'Approved. The workflow is resuming; see its run history for the result.' : approvalResult === 'rejected' ? 'Rejected. The run was stopped.' : 'This request was already answered.' }}
      </p>
    </div>

    <div
      v-else-if="output"
      class="p-4 border rounded-xl flex flex-col gap-3"
      :class="state === 'completed' ? 'border-primary/20 bg-primary/5' : state === 'rejected' ? 'border-default bg-elevated/40' : 'border-error/25 bg-error/5'"
    >
      <p class="text-sm text-default">
        {{ output.summary || output.error }}
      </p>

      <ul
        v-if="steps.length"
        class="flex flex-col gap-1.5"
      >
        <li
          v-for="step in steps"
          :key="step.nodeId"
          class="flex items-start gap-2 text-xs"
        >
          <UIcon
            :name="stepIcon(step.status)"
            class="size-4 shrink-0 mt-px"
            :class="stepColor(step.status)"
          />
          <div class="min-w-0 flex-1">
            <span class="font-medium text-highlighted">{{ step.title }}</span>
            <span
              v-if="step.message"
              class="text-muted"
            > · {{ step.message }}</span>
          </div>
          <UButton
            v-if="step.status === 'auth_required' && step.authUrl"
            :to="step.authUrl"
            target="_blank"
            size="xs"
            color="warning"
            variant="soft"
            label="Connect"
          />
        </li>
      </ul>

      <div
        v-if="hasOutputs"
        class="p-3 bg-elevated border border-default rounded-lg"
      >
        <h5 class="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">
          Final output
        </h5>
        <pre class="text-xs font-mono text-default whitespace-pre-wrap max-h-48 overflow-y-auto">{{ JSON.stringify(output.outputs, null, 2) }}</pre>
      </div>
    </div>
  </UChatTool>
</template>
