<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { ref } from 'vue'

const props = defineProps<{
  invocation: any
}>()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output)

const isLoading = ref(false)
const approvalResult = ref<'approved' | 'rejected' | null>(null)

async function handleApproval(approved: boolean) {
  if (!output.value?.runId) return
  isLoading.value = true
  try {
    await $fetch(`/api/workflows/${output.value.workflowId}/approve`, {
      method: 'POST',
      body: {
        runId: output.value.runId,
        approved,
        comments: approved ? 'Approved from chat tool' : 'Rejected from chat tool'
      }
    })
    approvalResult.value = approved ? 'approved' : 'rejected'
  } catch (error) {
    console.error('Failed to submit approval:', error)
  } finally {
    isLoading.value = false
  }
}


</script>

<template>
  <UChatTool
    :text="streaming ? 'Executing workflow pipeline...' : (output?.success ? 'Workflow executed' : 'Workflow execution failed')"
    :suffix="props.invocation.input?.workflowId"
    :streaming="streaming"
    icon="i-lucide-play-circle"
    chevron="leading"
  >
    
    <!-- Wait for Approval State -->
    <div v-if="output && output.status === 'waiting_approval'" class="p-4 border border-amber-500/20 bg-amber-500/5 rounded-xl flex flex-col gap-3">
      <div class="flex items-start gap-3">
        <div class="p-2.5 bg-amber-500/10 rounded-lg text-amber-600 mt-0.5">
          <UIcon name="i-lucide-shield-question" class="size-5" />
        </div>
        <div>
          <h4 class="font-semibold text-foreground text-sm">{{ output.title || 'Workflow paused for approval' }}</h4>
          <p class="text-xs text-muted mt-1">{{ output.approvalPrompt || 'This workflow requires human verification before continuing.' }}</p>
        </div>
      </div>
      
      <div class="flex items-center gap-2 mt-2" v-if="!approvalResult">
        <UButton color="emerald" icon="i-lucide-check" label="Approve & Continue" size="sm" :loading="isLoading" @click="handleApproval(true)" />
        <UButton color="red" variant="soft" icon="i-lucide-x" label="Reject / Abort" size="sm" :loading="isLoading" @click="handleApproval(false)" />
      </div>
      <div v-else class="text-xs font-semibold mt-2" :class="approvalResult === 'approved' ? 'text-emerald-500' : 'text-red-500'">
        {{ approvalResult === 'approved' ? 'Workflow Approved. Resuming...' : 'Workflow Rejected & Aborted.' }}
      </div>
    </div>

    <div v-else-if="output && output.success" class="p-4 border border-primary/20 bg-primary/5 rounded-xl flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <div class="p-2.5 bg-primary/10 rounded-lg text-primary">
          <UIcon name="i-lucide-activity" class="size-5" />
        </div>
        <div>
          <h4 class="font-semibold text-foreground text-sm">Execution Completed</h4>
          <p class="text-xs text-muted">{{ output.summary }}</p>
        </div>
      </div>
      
      <div v-if="output.outputs && Object.keys(output.outputs).length > 0" class="mt-2 p-3 bg-elevated border border-default rounded-lg">
        <h5 class="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">Final Output</h5>
        <div class="text-xs font-mono text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
          {{ JSON.stringify(output.outputs, null, 2) }}
        </div>
      </div>
    </div>
    
    <div v-else-if="output && !output.success" class="p-3 border border-red-500/20 bg-red-500/5 rounded-md text-red-600 dark:text-red-400 text-xs">
      <div class="font-semibold mb-1">Execution failed</div>
      <div class="opacity-80">{{ output.error }}</div>
    </div>
  </UChatTool>
</template>
