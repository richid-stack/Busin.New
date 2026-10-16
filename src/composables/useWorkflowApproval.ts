import { ref } from 'vue'
import { $fetch } from 'ofetch'

export type ApprovalResult = 'approved' | 'rejected' | 'handled' | null

/** Submits a human-in-the-loop decision for a paused workflow run. */
export function useWorkflowApproval(getTarget: () => { workflowId?: string, runId?: string }) {
  const toast = useToast()
  const loading = ref<'approve' | 'reject' | null>(null)
  const result = ref<ApprovalResult>(null)

  async function submit(approved: boolean, comments: string) {
    const { workflowId, runId } = getTarget()
    if (!workflowId || !runId) return

    loading.value = approved ? 'approve' : 'reject'
    try {
      await $fetch(`/api/workflows/${workflowId}/approve`, {
        method: 'POST',
        body: { runId, approved, comments }
      })
      result.value = approved ? 'approved' : 'rejected'
    } catch (error: any) {
      // 409: this request was already answered (earlier click, another tab, or the studio).
      if (error?.status === 409 || error?.statusCode === 409) {
        result.value = 'handled'
        return
      }
      toast.add({
        title: 'Could not submit your decision',
        description: error?.data?.statusMessage || error?.statusMessage || 'Please try again.',
        icon: 'i-lucide-alert-circle',
        color: 'error'
      })
    } finally {
      loading.value = null
    }
  }

  return { loading, result, submit }
}
