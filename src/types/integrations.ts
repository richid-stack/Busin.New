export interface IntegrationItem {
  provider: string
  name: string
  type: 'native' | 'composio' | 'custom'
  icon: string
  category: string
  status: 'connected' | 'disconnected'
  account: string
  connectionId?: string
  capabilities: string[]
  description: string
  canConnect: boolean
  supportedEventsCount?: number
  supportedActionsCount?: number
  externalLinks?: { website?: string; privacy?: string; terms?: string }
}
