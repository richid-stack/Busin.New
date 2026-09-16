const fs = require('fs')

const file = 'src/pages/chat/[id].vue'
let content = fs.readFileSync(file, 'utf8')

if (!content.includes('convertToWorkflow')) {
  const method = `
function convertToWorkflow(message) {
  sendMessage({ text: "Please convert the automated tasks we just discussed into an automated workflow pipeline." })
}
`
  content = content.replace(
    "function startEdit(message: UIMessage) {",
    method + "\nfunction startEdit(message: UIMessage) {"
  )
  
  content = content.replace(
    "@edit=\"startEdit\"",
    "@edit=\"startEdit\"\n              @convertToWorkflow=\"convertToWorkflow\""
  )
  
  fs.writeFileSync(file, content)
}
