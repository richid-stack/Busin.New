import { defineHandler } from 'nitro'
import { useUserSession } from '../../utils/session'
import { getUserWorkflows, createWorkflow } from '../../utils/firebase'
import { DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  const workflows = await getUserWorkflows(userId)

  // If user has no workflows yet, seed the default "Client Onboarding Pipeline"
  if (workflows.length === 0) {
    const defaultWorkflow = await createWorkflow({
      id: 'client-onboarding-pipeline',
      title: 'Client Onboarding Pipeline',
      description: 'Auto-triages new client inquiries from Gmail, drafts proposals, checks meeting availability, saves to Drive, and alerts Slack.',
      userId,
      nodes: DEFAULT_WORKFLOW_NODES,
      edges: DEFAULT_WORKFLOW_EDGES,
      status: 'active'
    })
    return [defaultWorkflow]
  }

  return workflows
})
