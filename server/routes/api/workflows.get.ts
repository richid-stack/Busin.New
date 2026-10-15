import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { getUserWorkflows, createWorkflow, resolveWorkflowId } from '../../utils/firebase'
import { DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const workflows = await getUserWorkflows(userId)

  // If the user has no workflows yet, seed their own copy of the default pipeline.
  if (workflows.length === 0) {
    try {
      const defaultWorkflow = await createWorkflow({
        id: resolveWorkflowId(userId, 'client-onboarding-pipeline'),
        title: 'Client Onboarding Pipeline',
        description: 'Auto-triages new client inquiries from Gmail, drafts proposals, checks meeting availability, saves to Drive, and alerts Slack.',
        userId,
        nodes: DEFAULT_WORKFLOW_NODES,
        edges: DEFAULT_WORKFLOW_EDGES,
        status: 'draft'
      })
      return [defaultWorkflow]
    } catch {
      // Created concurrently by another request: return what exists now.
      return await getUserWorkflows(userId)
    }
  }

  return workflows
})
