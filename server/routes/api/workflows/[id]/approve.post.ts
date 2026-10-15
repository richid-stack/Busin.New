import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { getFirebaseDb } from '../../../../utils/firebaseAdmin'
import { getWorkflow, getWorkflowRun, updateWorkflowRun, resolveWorkflowId } from '../../../../utils/firebase'
import { executeWorkflowDAG, DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../../../utils/workflowEngine'
import { postApprovalCard } from '../../../../utils/workflowRuns'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

  const { id: requestedId } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)
  const id = resolveWorkflowId(userId, requestedId)

  const body = await readValidatedBody(event, z.object({
    runId: z.string(),
    approved: z.boolean(),
    comments: z.string().max(2000).optional()
  }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Invalid approval body. runId (string) and approved (boolean) are required.' })
  })

  // 1. Fetch workflow run
  const run = await getWorkflowRun(id, body.runId)
  if (!run || run.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow run not found' })
  }

  // 2. Fetch workflow definition
  let workflow = await getWorkflow(id)
  if (!workflow && id !== requestedId) {
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
  }
  if (!workflow || workflow.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  // 3. Claim the approval atomically so a double-click cannot resume the run twice.
  const runRef = getFirebaseDb().collection('workflows').doc(id).collection('runs').doc(body.runId)
  await getFirebaseDb().runTransaction(async (tx) => {
    const snap = await tx.get(runRef)
    const status = snap.data()?.status
    if (status !== 'waiting_approval') {
      throw new HTTPError({
        statusCode: 409,
        statusMessage: `Workflow run is not waiting for approval (current status: ${status ?? 'unknown'})`
      })
    }
    tx.update(runRef, { status: 'running' })
  })

  const approvalNodeId = run.approvalNodeId || 'approval'
  const approver = user.name || userId

  try {
    // 4. Resume DAG execution
    const resume = await executeWorkflowDAG(workflow, run.input, userId, {
      resumeNodeId: approvalNodeId,
      existingOutputs: run.output || {},
      existingLogs: run.logs || [],
      approvalDecision: { approved: body.approved, comments: body.comments, approver }
    })

    // 5. Persist the outcome
    await updateWorkflowRun(id, body.runId, {
      status: resume.status,
      approvalNodeId: resume.approvalNodeId ?? null,
      approvalPrompt: resume.approvalPrompt ?? null,
      approvalData: resume.status === 'waiting_approval'
        ? resume.approvalData
        : {
            ...(run.approvalData || {}),
            approved: body.approved,
            decisionAt: new Date().toISOString(),
            approver,
            comments: body.comments
          },
      output: resume.outputs,
      logs: [...(run.logs || []), ...resume.logs],
      durationMs: (run.durationMs || 0) + resume.durationMs
    })

    const updatedRun = await getWorkflowRun(id, body.runId)

    // A later approval step in the same workflow needs its own card.
    if (resume.status === 'waiting_approval' && updatedRun) {
      await postApprovalCard(workflow.userId, workflow, updatedRun).catch(() => {})
    }

    return { success: true, run: updatedRun }
  } catch (err) {
    // Release the claim so the approval can be retried.
    await updateWorkflowRun(id, body.runId, { status: 'waiting_approval' }).catch(() => {})
    throw err
  }
})
