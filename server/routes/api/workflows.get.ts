import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { getUserWorkflows, ensureDefaultWorkflow } from '../../utils/firebase'
import { DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const workflows = await getUserWorkflows(user.id)

  // First visit: persist the user's own copy of the default pipeline (or migrate a legacy one).
  // A real failure propagates as a 500 instead of being reported as an empty list.
  if (workflows.length === 0) {
    await ensureDefaultWorkflow(user.id, { nodes: DEFAULT_WORKFLOW_NODES, edges: DEFAULT_WORKFLOW_EDGES })
    return await getUserWorkflows(user.id)
  }

  return workflows
})
