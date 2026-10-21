<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  invocation: any
}>()

const isLoading = ref(false)
const result = ref<'approved' | 'rejected' | null>(null)

// AI SDK v5+ tool parts carry `input`; older saved messages used `args`.
const args = props.invocation.input ?? props.invocation.args ?? {}
const workflowId = args.workflowId
const runId = args.runId
const title = args.title || 'Workflow'
const prompt = args.prompt

async function handleApproval(approved: boolean) {
  isLoading.value = true
  try {
    await $fetch(`/api/workflows/${workflowId}/approve`, {
      method: 'POST',
      body: {
        runId,
        approved,
        comments: approved ? 'Approved from chat' : 'Rejected from chat'
      }
    })
    result.value = approved ? 'approved' : 'rejected'
  } catch (error) {
    console.error('Failed to submit approval:', error)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <UChatTool
    :text="result === 'approved' ? 'Workflow Approved' : result === 'rejected' ? 'Workflow Rejected' : 'Approval Required'"
    :icon="result === 'approved' ? 'i-lucide-check-circle' : result === 'rejected' ? 'i-lucide-x-circle' : 'i-lucide-shield-alert'"
    :chevron="result === null ? 'leading' : 'none'"
  >
    <div class="p-4 border border-primary/20 bg-primary/5 rounded-xl flex flex-col gap-3" v-if="result === null">
      <div class="flex items-start gap-3">
        <div class="p-2.5 bg-primary/10 rounded-lg text-primary mt-0.5">
          <UIcon name="i-lucide-shield-question" class="size-5" />
        </div>
        <div>
          <h4 class="font-semibold text-foreground text-sm">{{ title }}</h4>
          <p class="text-xs text-muted mt-1">{{ prompt }}</p>
        </div>
      </div>
      
      <div class="flex items-center gap-2 mt-2">
        <UButton color="emerald" icon="i-lucide-check" label="Approve & Continue" size="sm" :loading="isLoading" @click="handleApproval(true)" />
        <UButton color="red" variant="soft" icon="i-lucide-x" label="Reject / Abort" size="sm" :loading="isLoading" @click="handleApproval(false)" />
      </div>
    </div>
  </UChatTool>
</template>
