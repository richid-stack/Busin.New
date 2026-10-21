import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { getWorkflow, saveWorkflowRun, getUserChats, createChat, saveChatMessage } from '../../../../utils/firebase'
import crypto from 'node:crypto'
import { executeWorkflowDAG, DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../../../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  const userId = user.id

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

  if (workflow.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  // Execute the workflow DAG
  const runResult = await executeWorkflowDAG(workflow, body.input, userId)

  // Save the run log to Firestore
  const runRecord = await saveWorkflowRun(workflow.id, {
    workflowId: workflow.id,
    userId,
    status: runResult.status,
    approvalNodeId: runResult.approvalNodeId,
    approvalPrompt: runResult.approvalPrompt,
    approvalData: runResult.approvalData,
    input: body.input || {},
    output: runResult.outputs,
    logs: runResult.logs,
    durationMs: runResult.durationMs
  })

  
  if (runResult.status === 'waiting_approval') {
    const chats = await getUserChats(userId)
    let targetChat = chats[0]
    if (!targetChat) {
      targetChat = await createChat({ userId, title: 'Workflow Approvals', visibility: 'private' })
    }
    
    await saveChatMessage(targetChat.id, {
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: [
        {
          type: 'tool-invocation',
          toolInvocation: {
            toolCallId: `call_${crypto.randomUUID()}`,
            toolName: 'workflow_approval',
            args: {
              workflowId: workflow.id,
              runId: runRecord.id,
              title: workflow.title,
              prompt: runResult.approvalPrompt,
              approvalData: runResult.approvalData
            },
            state: 'call'
          }
        }
      ],
      createdAt: new Date()
    })
  }

  return {
    success: true,
    run: runRecord
  }
})
