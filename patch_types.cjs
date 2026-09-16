const fs = require('fs')

const file = 'src/types/integrations.ts'
let content = fs.readFileSync(file, 'utf8')

content = content.replace(
  "capabilities: string[]\n  description: string\n  canConnect: boolean",
  "capabilities: string[]\n  description: string\n  canConnect: boolean\n  supportedEventsCount?: number\n  supportedActionsCount?: number\n  externalLinks?: { website?: string; privacy?: string; terms?: string }"
)

fs.writeFileSync(file, content)
