const fs = require('fs')

const file = 'server/routes/api/chats/[id].post.ts'
let content = fs.readFileSync(file, 'utf8')

const origInstruction = "- When the user asks about connected accounts or service status, call 'integration_status'."
const newInstruction = "- When the user asks to perform tasks using multiple tools (e.g., \"Read my emails and save to Drive\"), ALWAYS call 'integration_status' FIRST to verify if the tools are connected. If any required tool is not connected, provide the connection links (authUrl) returned by the tool so the user can connect them before proceeding.\n- When the user asks about connected accounts or service status, call 'integration_status'."

content = content.replace(origInstruction, newInstruction)

fs.writeFileSync(file, content)
