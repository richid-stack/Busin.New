import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { getWorkflow, updateWorkflow, generateWebhookSecret, resolveWorkflowId } from '../../../utils/firebase'
import { DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const user = await requireUser(event)

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(user.id, requestedId)

  const workflow = await getWorkflow(id)

  if (!workflow) {
    // Template of the default pipeline for this user (not persisted until they save it)
    if (id !== requestedId) {
      return {
        id,
        title: 'Client Onboarding Pipeline',
        description: 'Client Onboarding Pipeline with triage, proposal generation, and team alerts.',
        userId: user.id,
        status: 'active',
        nodes: DEFAULT_WORKFLOW_NODES,
        edges: DEFAULT_WORKFLOW_EDGES,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  if (workflow.userId !== user.id) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  // Workflows created before webhook secrets existed get one on first owner access.
  if (!workflow.webhookSecret) {
    workflow.webhookSecret = generateWebhookSecret()
    await updateWorkflow(id, { webhookSecret: workflow.webhookSecret })
  }

  return workflow
})
