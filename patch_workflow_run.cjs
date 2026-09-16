const fs = require('fs')

const file = 'src/components/chat/tool/WorkflowRun.vue'
let content = fs.readFileSync(file, 'utf8')

if (!content.includes('handleApproval')) {
  content = content.replace(
    "import { isToolStreaming } from '@nuxt/ui/utils/ai'",
    "import { isToolStreaming } from '@nuxt/ui/utils/ai'\nimport { ref } from 'vue'"
  )

  const handleApprovalMethod = `
const isLoading = ref(false)
const approvalResult = ref<'approved' | 'rejected' | null>(null)

async function handleApproval(approved: boolean) {
  if (!output.value?.runId) return
  isLoading.value = true
  try {
    const res = await $fetch(\`/api/workflows/\${output.value.workflowId}/approve\`, {
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
`
  content = content.replace(
    "const output = computed(() => props.invocation.output)",
    "const output = computed(() => props.invocation.output)\n" + handleApprovalMethod
  )

  const approvalBlock = `
    <!-- Wait for Approval State -->
    <div v-else-if="output && output.status === 'waiting_approval'" class="p-4 border border-amber-500/20 bg-amber-500/5 rounded-xl flex flex-col gap-3">
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
`

  content = content.replace(
    `<div v-if="output && output.success" class="p-4 border border-primary/20 bg-primary/5 rounded-xl flex flex-col gap-3">`,
    approvalBlock + `\n    <div v-else-if="output && output.success" class="p-4 border border-primary/20 bg-primary/5 rounded-xl flex flex-col gap-3">`
  )

  fs.writeFileSync(file, content)
}
