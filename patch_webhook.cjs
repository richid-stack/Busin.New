const fs = require('fs')

const file = 'server/routes/api/webhooks/[workflowId].post.ts'
let content = fs.readFileSync(file, 'utf8')

if (!content.includes('saveChatMessage')) {
  content = content.replace(
    "import { getWorkflow, saveWorkflowRun } from '../../../utils/firebase'",
    "import { getWorkflow, saveWorkflowRun, getUserChats, createChat, saveChatMessage } from '../../../utils/firebase'\nimport crypto from 'node:crypto'"
  )

  const appendCode = `
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
            toolCallId: \`call_\${crypto.randomUUID()}\`,
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
`
  
  content = content.replace(
    "return {",
    appendCode + "\n  return {"
  )
  
  fs.writeFileSync(file, content)
}
