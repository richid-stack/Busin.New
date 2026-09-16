const fs = require('fs')

const file = 'server/utils/tools/workflow.ts'
let content = fs.readFileSync(file, 'utf8')

const logic = `
  execute: async () => {
    try {
      const integrations = await getResolvedUserIntegrations('hansonmens784@gmail.com')
      
      const enriched = await Promise.all(integrations.map(async i => {
        let authUrl = \`/integrations/\${i.provider}\`
        if (i.type === 'composio' && i.status !== 'connected') {
          try {
            const link = await createComposioConnectionLink('hansonmens784@gmail.com', i.provider)
            if (link.redirectUrl) {
              authUrl = link.redirectUrl
            }
          } catch (e) {
            // ignore
          }
        }
        return {
          provider: i.provider,
          name: i.name,
          type: i.type,
          category: i.category,
          status: i.status,
          account: i.account,
          authUrl,
          capabilities: i.capabilities
        }
      }))

      return {
        connectedServices: enriched,
        defaultEmail: 'hansonmens784@gmail.com',
        readyForAutomation: true
      }
    } catch {
`

content = content.replace(
  /  execute: async \(\) => \{\n    try \{\n      const integrations = await getResolvedUserIntegrations\('system'\)\n      return \{\n        connectedServices: integrations\.map\(i => \(\{\n          provider: i\.provider,\n          name: i\.name,\n          type: i\.type,\n          category: i\.category,\n          status: i\.status,\n          account: i\.account,\n          capabilities: i\.capabilities\n        \}\)\),\n        defaultEmail: 'hansonmens784@gmail\.com',\n        readyForAutomation: true\n      \}\n    \} catch \{/m,
  logic.trim() + " {"
)

fs.writeFileSync(file, content)
