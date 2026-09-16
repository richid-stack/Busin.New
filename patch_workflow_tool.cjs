const fs = require('fs')

const file = 'server/utils/tools/workflow.ts'
let content = fs.readFileSync(file, 'utf8')

content = content.replace(
  `      await saveWorkflowRun(workflow.id, {
        workflowId: workflow.id,`,
  `      const runRecord = await saveWorkflowRun(workflow.id, {
        workflowId: workflow.id,
        approvalNodeId: result.approvalNodeId,
        approvalPrompt: result.approvalPrompt,
        approvalData: result.approvalData,`
)

content = content.replace(
  `        success: true,
        status: result.status,`,
  `        success: true,
        runId: runRecord.id,
        workflowId: workflow.id,
        title: workflow.title,
        approvalPrompt: result.approvalPrompt,
        approvalData: result.approvalData,
        status: result.status,`
)

fs.writeFileSync(file, content)
