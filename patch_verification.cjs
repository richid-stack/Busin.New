const fs = require('fs')

const file = 'server/services/integrations/registry.ts'
let content = fs.readFileSync(file, 'utf8')

const verificationLogic = `
  const resolved = ALL_INTEGRATIONS_CATALOG.map(catalogItem => {
    // Check if user has a Firestore record
    const firestoreRecord = firestoreIntegrations.find(f => f.provider === catalogItem.provider)
    
    // Check if user has a Composio connected account
    const composioConn = composioConnections.find(c => c.toolkitSlug === catalogItem.provider && c.status === 'ACTIVE')
    
    let status: 'connected' | 'disconnected' = 'disconnected'
    let account = 'Not connected'
    let connectionId: string | undefined

    if (catalogItem.type === 'native') {
      if (firestoreRecord && firestoreRecord.status === 'connected') {
        status = 'connected'
        account = firestoreRecord.account || 'Google Account Connected'
      }
    } else if (catalogItem.type === 'composio') {
      if (composioConn) {
        status = 'connected'
        account = composioConn.accountName || \`Connected (\${catalogItem.name})\`
        connectionId = composioConn.id
      } else if (firestoreRecord && firestoreRecord.status === 'connected') {
        status = 'connected'
        account = firestoreRecord.account || 'Connected'
      }
    }

    return {
      provider: catalogItem.provider,
      name: catalogItem.name,
      type: catalogItem.type,
      icon: catalogItem.icon,
      category: catalogItem.category,
      status,
      account,
      connectionId,
      capabilities: catalogItem.capabilities,
      description: catalogItem.description,
      supportedEventsCount: catalogItem.supportedEvents?.length || 0,
      supportedActionsCount: catalogItem.supportedActions?.length || 0,
      externalLinks: AUTHENTIC_LINKS[catalogItem.provider] || { website: 'https://example.com', privacy: 'https://example.com/privacy', terms: 'https://example.com/terms' },
      canConnect: catalogItem.type === 'native' || composioConfigured
    }
  })

  // Ping connected providers to confirm token validity
  const validated = await Promise.all(resolved.map(async (item) => {
    if (item.status === 'connected' && item.type === 'composio') {
      try {
        const ping = await executeSafeVerificationTool(userId, item.provider)
        if (!ping.connected || !ping.success) {
          item.status = 'disconnected'
          item.account = 'Token expired - Please reconnect'
        }
      } catch (e) {
        item.status = 'disconnected'
        item.account = 'Token validation failed'
      }
    }
    return item as ResolvedUserIntegration
  }))

  return validated
}
`

content = content.replace(
  /return ALL_INTEGRATIONS_CATALOG\.map\(catalogItem => \{[\s\S]*?canConnect: catalogItem\.type === 'native' \|\| composioConfigured\n    \}\n  \}\)/m,
  verificationLogic.trim()
)

fs.writeFileSync(file, content)
