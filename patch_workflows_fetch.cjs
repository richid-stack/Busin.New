const fs = require('fs');
let code = fs.readFileSync('src/pages/workflows/index.vue', 'utf8');

// Replace static edges
code = code.replace(/const edges = ref<any\[\]>\(\[[\s\S]*?\]\)/, "const edges = ref<any[]>([])");

// Replace static nodes
code = code.replace(/const nodes = ref<any\[\]>\(\[[\s\S]*?\]\)/, "const nodes = ref<any[]>([])");

// Inject loadData inside onMounted
const loadLogic = `
  const workflowId = route.query.id as string
  try {
    let workflow = null
    if (workflowId) {
      const res = await fetch(\`/api/workflows/\${workflowId}\`)
      if (res.ok) workflow = await res.json()
    }
    if (!workflow) {
      const resList = await fetch('/api/workflows')
      if (resList.ok) {
        const list = await resList.json()
        if (list && list.length > 0) workflow = list[0]
      }
    }
    if (workflow) {
      nodes.value = workflow.nodes || []
      edges.value = workflow.edges || []
      setTimeout(() => {
        fitView({ padding: 0.2, includeHiddenNodes: true })
      }, 100)
    }
  } catch (err) {
    console.error('Failed to load workflow:', err)
  }
`;

code = code.replace(
  /onMounted\(\(\) => \{([\s\S]*?loadIntegrations\(\)[\s\S]*?)\}/,
  `onMounted(async () => {$1${loadLogic}})`
);

fs.writeFileSync('src/pages/workflows/index.vue', code);
console.log('Fetch Patch applied');
