const fs = require('fs');
let code = fs.readFileSync('src/components/chat/message/MessageContent.vue', 'utf8');

if (!code.includes('ChatToolWorkflowCreate')) {
  code = code.replace(
    /import ChatToolGeneric from '\.\.\/tool\/Generic\.vue'/,
    "import ChatToolGeneric from '../tool/Generic.vue'\nimport ChatToolWorkflowCreate from '../tool/WorkflowCreate.vue'"
  );
  
  code = code.replace(
    /import type \{ CalculatorUIToolInvocation \} from '\.\.\/\.\.\/\.\.\/\.\.\/server\/utils\/tools\/calculator'/,
    "import type { CalculatorUIToolInvocation } from '../../../../server/utils/tools/calculator'\nimport type { ToolInvocation } from 'ai'"
  );
  
  code = code.replace(
    /<ChatToolGeneric\n\s*v-else\n\s*:part="part"\n\s*\/>/,
    `<ChatToolWorkflowCreate
        v-else-if="getToolName(part) === 'workflow_create'"
        :invocation="{ ...(part as unknown as ToolInvocation) }"
      />
      <ChatToolGeneric
        v-else
        :part="part"
      />`
  );
  fs.writeFileSync('src/components/chat/message/MessageContent.vue', code);
  console.log('MessageContent patch applied');
} else {
  console.log('MessageContent already patched');
}
