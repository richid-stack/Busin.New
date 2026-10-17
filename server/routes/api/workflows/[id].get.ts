import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getWorkflow, ensureDefaultWorkflow, ensureWebhookSecret, resolveWorkflowId } from '../../../utils/firebase'
import { DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(user.id, requestedId)

  // The built-in pipeline is persisted on first access (migrating a legacy copy the user owns).
  const workflow = id !== requestedId
    ? await ensureDefaultWorkflow(user.id, { nodes: DEFAULT_WORKFLOW_NODES, edges: DEFAULT_WORKFLOW_EDGES })
    : await getWorkflow(id)

  if (!workflow) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  if (workflow.userId !== user.id) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  // Workflows created before webhook secrets existed get one on first owner access.
  if (!workflow.webhookSecret) {
    workflow.webhookSecret = await ensureWebhookSecret(id)
  }

  return workflow
})
