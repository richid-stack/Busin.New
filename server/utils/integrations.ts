export interface IntegrationConfig {
  provider: 'gmail' | 'slack' | 'google_drive' | 'notion' | 'github'
  name: string
  icon: string
  account: string
  status: 'connected' | 'disconnected'
  capabilities: string[]
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
}

export const DEFAULT_INTEGRATIONS: IntegrationConfig[] = [
  {
    provider: 'gmail',
    name: 'Gmail',
    icon: 'i-logos-google-gmail',
    account: 'Google Account',
    status: 'connected',
    description: 'Listen for client incoming emails, read attachments, and draft automated replies.',
    capabilities: ['read_emails', 'send_email', 'draft_reply', 'watch_inbox']
  },
  {
    provider: 'google_drive',
    name: 'Google Drive',
    icon: 'i-logos-google-drive',
    account: 'Google Account',
    status: 'connected',
    description: 'Auto-create executive proposals, store PDFs, and manage client project folders.',
    capabilities: ['upload_file', 'create_folder', 'export_pdf', 'search_files']
  },
  {
    provider: 'slack',
    name: 'Slack',
    icon: 'i-logos-slack-icon',
    account: 'Workspace',
    status: 'connected',
    description: 'Send instant alerts to #client-alerts and dispatch priority tasks.',
    capabilities: ['send_channel_message', 'notify_team', 'create_reminder']
  },
  {
    provider: 'notion',
    name: 'Notion',
    icon: 'i-logos-notion-icon',
    account: 'Not connected',
    status: 'disconnected',
    description: 'Log onboarding items and sync client requirement tables.',
    capabilities: ['create_page', 'append_database']
  }
]
