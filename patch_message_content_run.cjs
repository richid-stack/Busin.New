const fs = require('fs');
let code = fs.readFileSync('src/components/chat/message/MessageContent.vue', 'utf8');

if (!code.includes('ChatToolWorkflowRun')) {
  code = code.replace(
    /import ChatToolWorkflowCreate from '\.\.\/tool\/WorkflowCreate\.vue'/,
    "import ChatToolWorkflowCreate from '../tool/WorkflowCreate.vue'\nimport ChatToolWorkflowRun from '../tool/WorkflowRun.vue'"
  );
  
  code = code.replace(
    /<ChatToolWorkflowCreate\n\s*v-else-if="getToolName\(part\) === 'workflow_create'"\n\s*:invocation="\{ \.\.\.\(part as unknown as ToolInvocation\) \}"\n\s*\/>/,
    `<ChatToolWorkflowCreate
        v-else-if="getToolName(part) === 'workflow_create'"
        :invocation="{ ...(part as unknown as ToolInvocation) }"
      />
      <ChatToolWorkflowRun
        v-else-if="getToolName(part) === 'workflow_run'"
        :invocation="{ ...(part as unknown as ToolInvocation) }"
      />`
  );
  fs.writeFileSync('src/components/chat/message/MessageContent.vue', code);
  console.log('MessageContent run patch applied');
} else {
  console.log('MessageContent run already patched');
}
