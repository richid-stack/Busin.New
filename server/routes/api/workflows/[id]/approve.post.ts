import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../../utils/session'
import { getWorkflow, getWorkflowRun, updateWorkflowRun } from '../../../../utils/firebase'
import { executeWorkflowDAG, DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const body = await readValidatedBody(event, z.object({
    runId: z.string(),
    approved: z.boolean(),
    comments: z.string().optional()
  }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid approval body. runId (string) and approved (boolean) are required.' })
  })

  // 1. Fetch workflow run
  const run = await getWorkflowRun(id, body.runId)
  if (!run) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow run not found' })
  }

  if (run.status !== 'waiting_approval') {
    throw new HTTPError({
      statusCode: 400,
      statusMessage: `Workflow run is not waiting for approval (current status: ${run.status})`
    })
  }

  // 2. Fetch workflow definition
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

  const approvalNodeId = run.approvalNodeId || 'approval'

  // 3. Resume DAG execution
  const resumeResult = await executeWorkflowDAG(
    workflow,
    run.input,
    userId,
    {
      resumeNodeId: approvalNodeId,
      existingOutputs: run.output || {},
      approvalDecision: {
        approved: body.approved,
        comments: body.comments,
        approver: session.data.user?.name || userId
      }
    }
  )

  // Merge logs
  const combinedLogs = [...(run.logs || []), ...resumeResult.logs]
  const finalStatus = resumeResult.status

  // 4. Update workflow run in Firestore
  await updateWorkflowRun(id, body.runId, {
    status: finalStatus,
    approvalData: {
      ...(run.approvalData || {}),
      approved: body.approved,
      decisionAt: new Date().toISOString(),
      approver: session.data.user?.name || userId,
      comments: body.comments
    },
    output: resumeResult.outputs,
    logs: combinedLogs,
    durationMs: (run.durationMs || 0) + resumeResult.durationMs
  })

  const updatedRun = await getWorkflowRun(id, body.runId)

  return {
    success: true,
    run: updatedRun
  }
})
