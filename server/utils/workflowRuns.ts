import crypto from 'node:crypto'
import { assertNotDeleting, isDeleting } from '../services/account/tombstone'
import { defaultNotifyDeps, notifyApprovalWaiting } from '../services/notifications/notify'
import { executeWorkflowDAG, type WorkflowRunResult } from './workflowEngine'
import {
  saveWorkflowRun,
  updateWorkflowRun,
  getUserChats,
  createChat,
  saveChatMessage,
  type FirestoreWorkflow,
  type FirestoreWorkflowRun
} from './firebase'

const APPROVALS_CHAT_TITLE = 'Workflow Approvals'

/**
 * Posts an approval card into the owner's "Workflow Approvals" chat so they can
 * approve or reject from the chat UI. Uses the AI SDK v5+ tool-part shape
 * (`tool-<name>` with `input`/`output`) that the chat renderer expects.
 */
export async function postApprovalCard(
  ownerId: string,
  workflow: FirestoreWorkflow,
  run: FirestoreWorkflowRun
): Promise<string> {
  await assertNotDeleting(ownerId)
  const chats = await getUserChats(ownerId)
  let chat = chats.find(c => c.title === APPROVALS_CHAT_TITLE)
  if (!chat) {
    chat = await createChat({ userId: ownerId, title: APPROVALS_CHAT_TITLE })
  }

  await saveChatMessage(chat.id, {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [
      {
        type: 'tool-workflow_approval',
        toolCallId: `call_${crypto.randomUUID()}`,
        state: 'output-available',
        input: {
          workflowId: workflow.id,
          runId: run.id,
          title: workflow.title,
          prompt: run.approvalPrompt,
          approvalData: run.approvalData
        },
        output: { status: 'waiting_approval', runId: run.id, workflowId: workflow.id }
      }
    ],
    createdAt: new Date()
  })
  return chat.id
}

/** Executes a workflow, records the run, and raises an approval card if it paused. */
export async function executeAndRecordRun(
  workflow: FirestoreWorkflow,
  input: Record<string, any> | undefined,
  userId: string,
  /** True when nobody is watching (a schedule or a webhook started it): a pause for approval then alerts the owner. */
  options: { background?: boolean } = {}
): Promise<{ run: FirestoreWorkflowRun, result: WorkflowRunResult }> {
  // Nothing runs for an account that is being deleted: the steps could call out and spend credits for a person who is leaving.
  if (await isDeleting(userId)) throw new Error('This account is being deleted.')
  const result = await executeWorkflowDAG(workflow, input, userId)

  const run = await saveWorkflowRun(workflow.id, {
    workflowId: workflow.id,
    userId,
    status: result.status,
    approvalNodeId: result.approvalNodeId,
    approvalPrompt: result.approvalPrompt,
    approvalData: result.approvalData,
    input: input || {},
    output: result.outputs,
    logs: result.logs,
    durationMs: result.durationMs
  })

  if (result.status === 'waiting_approval') {
    // Approval requests go to the workflow owner, even for webhook-triggered runs.
    const chatId = await postApprovalCard(workflow.userId, workflow, run).catch(async (err) => {
      console.warn('[workflow] Failed to post approval card:', err)
      // The run is still approvable from the studio; record that the chat card never arrived.
      await updateWorkflowRun(workflow.id, run.id, { approvalData: { ...(run.approvalData || {}), cardDeliveryFailed: true } }).catch(() => {})
      return undefined
    })
    if (options.background) {
      await notifyApprovalWaiting(defaultNotifyDeps(), { userId: workflow.userId, workflowId: workflow.id, workflowName: String(workflow.title || 'Workflow'), runId: run.id, prompt: run.approvalPrompt, chatId })
        .catch(err => console.warn('[notify] Approval alert not sent:', err?.message))
    }
  }

  return { run, result }
}
