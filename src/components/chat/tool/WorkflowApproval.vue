<script setup lang="ts">
import { computed } from 'vue'
import { useWorkflowApproval } from '../../../composables/useWorkflowApproval'

const props = defineProps<{
  invocation: any
}>()

// AI SDK v5+ tool parts carry `input`; older saved messages used `args`.
const args = computed(() => props.invocation.input ?? props.invocation.args ?? {})
const workflowId = computed(() => args.value.workflowId)
const runId = computed(() => args.value.runId)
const title = computed(() => args.value.title || 'Workflow')
const prompt = computed(() => args.value.prompt)

const { loading: isLoading, result, submit } = useWorkflowApproval(() => ({
  workflowId: workflowId.value,
  runId: runId.value
}))

function handleApproval(approved: boolean) {
  return submit(approved, approved ? 'Approved from chat' : 'Rejected from chat')
}

const heading = computed(() => {
  if (result.value === 'approved') return 'Workflow approved'
  if (result.value === 'rejected') return 'Workflow rejected'
  if (result.value === 'handled') return 'Already answered'
  return 'Approval required'
})

const icon = computed(() => {
  if (result.value === 'approved') return 'i-lucide-check-circle'
  if (result.value === 'rejected') return 'i-lucide-x-circle'
  if (result.value === 'handled') return 'i-lucide-check-check'
  return 'i-lucide-shield-alert'
})
</script>

<template>
  <UChatTool
    :text="heading"
    :icon="icon"
    chevron="leading"
    :default-open="result === null"
  >
    <div
      v-if="result === null"
      class="p-4 border border-primary/20 bg-primary/5 rounded-xl flex flex-col gap-3"
    >
      <div class="flex items-start gap-3">
        <div class="p-2.5 bg-primary/10 rounded-lg text-primary mt-0.5">
          <UIcon
            name="i-lucide-shield-question"
            class="size-5"
          />
        </div>
        <div class="min-w-0">
          <h4 class="font-semibold text-highlighted text-sm">
            {{ title }}
          </h4>
          <p class="text-xs text-muted mt-1 whitespace-pre-wrap">
            {{ prompt }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 mt-2">
        <UButton
          color="success"
          icon="i-lucide-check"
          label="Approve & continue"
          size="sm"
          :loading="isLoading === 'approve'"
          :disabled="isLoading !== null"
          @click="handleApproval(true)"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-x"
          label="Reject"
          size="sm"
          :loading="isLoading === 'reject'"
          :disabled="isLoading !== null"
          @click="handleApproval(false)"
        />
      </div>
    </div>

    <p
      v-else
      class="text-xs"
      :class="result === 'approved' ? 'text-success' : result === 'rejected' ? 'text-error' : 'text-muted'"
    >
      <template v-if="result === 'approved'">
        Approved. The workflow is resuming; results will appear in its run history.
      </template>
      <template v-else-if="result === 'rejected'">
        Rejected. The workflow run was stopped.
      </template>
      <template v-else>
        This request was already answered, so nothing more is needed.
      </template>
    </p>
  </UChatTool>
</template>
