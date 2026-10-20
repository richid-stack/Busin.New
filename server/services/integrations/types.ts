export type IntegrationCategory =
  | 'google'
  | 'communication'
  | 'productivity'
  | 'project_management'
  | 'crm'
  | 'developer'
  | 'ghana'

export interface IntegrationAction {
  id: string
  name: string
  description: string
}

export interface UnifiedIntegrationDefinition {
  provider: string
  name: string
  /** 'native' = Google Workspace apps (executed through Composio's Google toolkits), 'composio' = third-party apps */
  type: 'native' | 'composio' | 'custom'
  icon: string
  category: IntegrationCategory
  description: string
  capabilities: string[]
  supportedEvents?: string[]
  supportedActions?: IntegrationAction[]
  /** custom connectors: what a person pastes to connect (never a secret value) */
  credentialFields?: Array<{ id: string, label: string, placeholder?: string, help?: string, secret: boolean }>
  keyAdvice?: string
}
