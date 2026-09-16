const fs = require('fs')

const file = 'server/services/integrations/registry.ts'
let content = fs.readFileSync(file, 'utf8')

content = content.replace(
  "capabilities: string[]\n  description: string\n  canConnect: boolean",
  "capabilities: string[]\n  description: string\n  canConnect: boolean\n  supportedEventsCount?: number\n  supportedActionsCount?: number\n  externalLinks?: { website?: string; privacy?: string; terms?: string }"
)

content = content.replace(
  "capabilities: catalogItem.capabilities,\n      description: catalogItem.description,",
  "capabilities: catalogItem.capabilities,\n      description: catalogItem.description,\n      supportedEventsCount: catalogItem.supportedEvents?.length || 0,\n      supportedActionsCount: catalogItem.supportedActions?.length || 0,\n      externalLinks: { website: 'https://example.com', privacy: 'https://example.com/privacy', terms: 'https://example.com/terms' },"
)

fs.writeFileSync(file, content)
