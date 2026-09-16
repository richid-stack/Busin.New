const fs = require('fs')

const file = 'src/components/chat/message/MessageActions.vue'
let content = fs.readFileSync(file, 'utf8')

if (!content.includes('convertToWorkflow')) {
  content = content.replace(
    "vote: [message: UIMessage, isUpvoted: boolean]\n}>()",
    "vote: [message: UIMessage, isUpvoted: boolean]\n  convertToWorkflow: [message: UIMessage]\n}>()"
  )

  const workflowBtn = `    <UTooltip text="Convert to Automated Workflow">
      <UButton
        size="sm"
        color="primary"
        variant="ghost"
        icon="i-lucide-workflow"
        aria-label="Convert to Automated Workflow"
        @click="emit('convertToWorkflow', message)"
      />
    </UTooltip>`

  content = content.replace(
    `<UTooltip text="Regenerate response">`,
    `${workflowBtn}\n    <UTooltip text="Regenerate response">`
  )

  fs.writeFileSync(file, content)
}
