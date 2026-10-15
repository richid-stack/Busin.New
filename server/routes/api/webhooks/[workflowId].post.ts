import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readBody, getQuery } from 'nitro/h3'
import { z } from 'zod'
import { getWorkflow, saveWorkflowRun, getUserChats, createChat, saveChatMessage } from '../../../utils/firebase'
import crypto from 'node:crypto'
import { getHeader } from 'nitro/h3'
import { executeWorkflowDAG } from '../../../utils/workflowEngine'

export default defineHandler(async (event) => {
  const { workflowId } = await getValidatedRouterParams(event, z.object({
    workflowId: z.string()
  }).parse)

  let body = {}
  try {
    body = await readBody(event) || {}
  } catch (e) {
    // If not JSON, ignore
  }

  const query = getQuery(event)

  const workflow = await getWorkflow(workflowId)

  if (!workflow) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  // The endpoint is public, so every call must present the workflow's secret
  // (`x-webhook-secret` header or `?secret=`). Compared in constant time.
  const provided = getHeader(event, 'x-webhook-secret') || (typeof query.secret === 'string' ? query.secret : '')
  const expected = workflow.webhookSecret || ''
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid or missing webhook secret' })
  }

  // Never persist the secret into run inputs/logs
  const safeHeaders = Object.fromEntries(event.headers.entries())
  delete safeHeaders['x-webhook-secret']
  const { secret: _secret, ...safeQuery } = query as Record<string, unknown>

  const payload = {
    method: event.method,
    headers: safeHeaders,
    query: safeQuery,
    body
  }

  // Find trigger node (by provider webhook, subtype webhook, or generic trigger)
  const triggerNode = workflow.nodes?.find(n =>
    n.type === 'trigger' && (n.data?.provider === 'webhook' || n.data?.subtype === 'webhook')
  ) || workflow.nodes?.find(n => n.type === 'trigger')
  
  const inputMap: Record<string, any> = {}
  if (triggerNode) {
    inputMap[triggerNode.id] = payload
  }
  inputMap['webhook'] = payload
  inputMap['trigger'] = payload

  // Execute the workflow DAG
  const runResult = await executeWorkflowDAG(workflow, inputMap, workflow.userId)

  // Save the run log to Firestore
  const savedRun = await saveWorkflowRun(workflow.id, {
    workflowId: workflow.id,
    userId: workflow.userId,
    status: runResult.status,
    approvalNodeId: runResult.approvalNodeId,
    approvalPrompt: runResult.approvalPrompt,
    approvalData: runResult.approvalData,
    input: inputMap,
    output: runResult.outputs,
    logs: runResult.logs,
    durationMs: runResult.durationMs
  })

  
  if (runResult.status === 'waiting_approval') {
    const chats = await getUserChats(workflow.userId)
    let targetChat = chats[0]
    if (!targetChat) {
      targetChat = await createChat({ userId: workflow.userId, title: 'Workflow Approvals', visibility: 'private' })
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
              runId: savedRun.id,
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
    runId: savedRun.id,
    status: runResult.status,
    approvalRequired: runResult.status === 'waiting_approval',
    durationMs: runResult.durationMs
  }
})
