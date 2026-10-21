import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { getWorkflow, resolveWorkflowId } from '../../../../utils/firebase'
import { DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../../../utils/workflowEngine'
import { executeAndRecordRun } from '../../../../utils/workflowRuns'
import { enforceRateLimit } from '../../../../utils/rateLimit'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id
  enforceRateLimit(event, 'workflow-run', userId, 30, 10 * 60_000)

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(userId, requestedId)

  const body = await readValidatedBody(event, z.object({
    input: z.record(z.string(), z.any()).optional()
  }).parse).catch(() => ({ input: undefined }))

  let workflow = await getWorkflow(id)

  if (!workflow) {
    // Built-in default pipeline that has not been saved yet
    if (id !== requestedId) {
      workflow = {
        id,
        title: 'Client Onboarding Pipeline',
        description: 'Default onboarding pipeline',
        userId,
        status: 'active',
        nodes: DEFAULT_WORKFLOW_NODES,
        edges: DEFAULT_WORKFLOW_EDGES,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    } else {
      throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
    }
  }

  if (workflow.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  const { run } = await executeAndRecordRun(workflow, body.input, userId)

  return {
    success: run.status !== 'failed',
    run
  }
})
