const fs = require('fs');
let code = fs.readFileSync('src/pages/workflows/index.vue', 'utf8');

// Make System Instructions reactive
code = code.replace(
  /<UTextarea\s*autoresize\s*:rows="5"\s*class="w-full text-xs"\s*:model-value="selectedNode\.id === 'ai-triage' \? 'Analyze incoming enterprise email communications\. Extract core objectives, decision-makers, and key deliverables\.' : 'Draft an executive enterprise proposal PDF summarizing multi-region deployment and security SLA\.'"\s*\/>/g,
  `<UTextarea
                  autoresize
                  :rows="5"
                  class="w-full text-xs"
                  v-model="selectedNode.data.prompt"
                  @input="onNodeDataChange"
                />`
);

// We should also replace the trigger Account hardcode with a dynamic selection if we can, or just show the actual connected account
code = code.replace(
  /<div class="p-2 rounded-md border border-default bg-background text-xs font-mono text-muted truncate">\s*hansonmens784@gmail\.com\s*<\/div>/g,
  `<div class="p-2 rounded-md border border-default bg-background text-xs font-mono text-muted truncate">
                  {{ selectedNode.data.connection || 'Not connected' }}
                </div>`
);

fs.writeFileSync('src/pages/workflows/index.vue', code);
console.log('Reactivity Patch 2 applied');
