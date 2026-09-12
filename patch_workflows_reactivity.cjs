const fs = require('fs');
let code = fs.readFileSync('src/pages/workflows/index.vue', 'utf8');

// Add useModels import
if (!code.includes('useModels')) {
  code = code.replace(
    /import { useIntegrationsModal } from '\.\.\/\.\.\/composables\/useIntegrationsModal'/,
    "import { useIntegrationsModal } from '../../composables/useIntegrationsModal'\nimport { useModels } from '../../composables/useModels'\nimport { useRoute } from 'vue-router'"
  );
}

// Add useModels and route composables
if (!code.includes('const { models } = useModels()')) {
  code = code.replace(
    /const { openIntegrationsModal } = useIntegrationsModal\(\)/,
    "const { openIntegrationsModal } = useIntegrationsModal()\nconst { models } = useModels()\nconst route = useRoute()"
  );
}

// Add onNodeDataChange
if (!code.includes('const onNodeDataChange = (val) => {')) {
  code = code.replace(
    /const onNodeClick = \(event: any\) => \{/,
    "const { updateNodeData } = useVueFlow()\nconst onNodeDataChange = () => {\n  if (selectedNode.value) {\n    updateNodeData(selectedNode.value.id, { ...selectedNode.value.data })\n  }\n}\n\nconst onNodeClick = (event: any) => {"
  );
}

// Make Event USelect reactive
code = code.replace(
  /<USelect\s*:options="\[\{ label: 'New Email Received', value: 'new_email' \}, \{ label: 'Important Email Received', value: 'important_email' \}\]"\s*model-value="new_email"/g,
  `<USelect
                  :options="[{ label: 'New Email Received', value: 'new_email' }, { label: 'Important Email Received', value: 'important_email' }]"
                  v-model="selectedNode.data.event"
                  @change="onNodeDataChange"`
);

// Make Gemini USelect reactive
code = code.replace(
  /<USelect\s*:options="\[\{ label: 'Gemini 3\.5 Flash', value: 'gemini-3\.5-flash' \}, \{ label: 'Gemini 1\.5 Pro', value: 'gemini-1\.5-pro' \}\]"\s*model-value="gemini-3\.5-flash"/g,
  `<USelect
                  :options="models"
                  v-model="selectedNode.data.model"
                  @change="onNodeDataChange"`
);

fs.writeFileSync('src/pages/workflows/index.vue', code);
console.log('Reactivity Patch applied');
