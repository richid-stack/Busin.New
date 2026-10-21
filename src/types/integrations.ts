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
  /** key-based connectors: what to paste, and the end of the key already saved */
  credentialFields?: Array<{ id: string, label: string, placeholder?: string, help?: string, secret: boolean }>
  keyAdvice?: string
  getKeyUrl?: string
  keyHint?: string
}
