import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../../utils/session'
import { getWorkflow, saveWorkflowRun } from '../../../../utils/firebase'
import { executeWorkflowDAG, DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const body = await readValidatedBody(event, z.object({
    input: z.record(z.string(), z.any()).optional()
  }).parse).catch(() => ({ input: undefined }))

  let workflow = await getWorkflow(id)

  if (!workflow) {
    if (id === 'client-onboarding-pipeline' || id === 'default') {
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

  // Execute the workflow DAG
  const runResult = await executeWorkflowDAG(workflow, body.input, userId)

  // Save the run log to Firestore
  const runRecord = await saveWorkflowRun(workflow.id, {
    workflowId: workflow.id,
    userId,
    status: runResult.status,
    input: body.input || {},
    output: runResult.outputs,
    logs: runResult.logs,
    durationMs: runResult.durationMs
  })

  return {
    success: true,
    run: runRecord
  }
})
