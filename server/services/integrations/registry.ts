import type { UnifiedIntegrationDefinition, IntegrationCategory } from './types'
import { listComposioUserConnections, isComposioConfigured, POPULAR_COMPOSIO_TOOLKITS } from '../composio/client'
import { runIntegrationInstruction } from './execute'

/**
 * Google Workspace integrations. Shown as 'native' in the UI, but connected and executed through
 * Composio's Google toolkits, like every other provider, so there is a single code path.
 */
export const NATIVE_GOOGLE_INTEGRATIONS: UnifiedIntegrationDefinition[] = [
  {
    provider: 'gmail',
    name: 'Gmail',
    type: 'native',
    icon: 'i-logos-google-gmail',
    category: 'google',
    description: 'Read client emails, watch incoming messages, extract attachments, and draft automated replies.',
    capabilities: ['read_emails', 'send_email', 'draft_reply', 'watch_inbox', 'search_messages'],
    supportedEvents: ['New Email Received', 'Email Label Added', 'Starred Message'],
    supportedActions: [
      { id: 'gmail_send_email', name: 'Send Email', description: 'Send an email to a recipient' },
      { id: 'gmail_create_draft', name: 'Create Draft', description: 'Create a draft email for review' },
      { id: 'gmail_search_emails', name: 'Search Emails', description: 'Search emails by query or sender' }
    ]
  },
  {
    provider: 'google_drive',
    name: 'Google Drive',
    type: 'native',
    icon: 'i-logos-google-drive',
    category: 'google',
    description: 'Auto-create proposals, organize client folders, upload files, and manage PDF exports.',
    capabilities: ['upload_file', 'create_folder', 'export_pdf', 'search_files', 'share_document'],
    supportedEvents: ['File Created', 'File Updated in Folder'],
    supportedActions: [
      { id: 'drive_upload_file', name: 'Upload File', description: 'Upload generated file or proposal' },
      { id: 'drive_create_folder', name: 'Create Folder', description: 'Create client project folder' },
      { id: 'drive_search', name: 'Search Files', description: 'Find existing documents in Drive' }
    ]
  },
  {
    provider: 'google_calendar',
    name: 'Google Calendar',
    type: 'native',
    icon: 'i-logos-google-calendar',
    category: 'google',
    description: 'Extract meeting timeslots, check availability, schedule kickoff calls, and create calendar holds.',
    capabilities: ['create_event', 'find_free_slots', 'list_events', 'send_invites'],
    supportedEvents: ['Event Starting Soon', 'New Calendar Invite'],
    supportedActions: [
      { id: 'calendar_create_event', name: 'Schedule Meeting', description: 'Create a calendar event with invitees' },
      { id: 'calendar_find_slots', name: 'Find Availability', description: 'Find mutually available timeslots' }
    ]
  },
  {
    provider: 'google_docs',
    name: 'Google Docs',
    type: 'native',
    icon: 'i-simple-icons:googledocs',
    category: 'google',
    description: 'Generate client proposals, technical requirements documents, and executive summaries.',
    capabilities: ['create_document', 'append_text', 'export_to_pdf'],
    supportedEvents: ['Document Modified'],
    supportedActions: [
      { id: 'docs_create_doc', name: 'Create Document', description: 'Create a new styled Google Doc' },
      { id: 'docs_append_content', name: 'Append Content', description: 'Insert markdown or text into a Google Doc' }
    ]
  },
  {
    provider: 'google_sheets',
    name: 'Google Sheets',
    type: 'native',
    icon: 'i-simple-icons:googlesheets',
    category: 'google',
    description: 'Log onboarding data, sync client records, and append rows into financial models.',
    capabilities: ['append_row', 'read_sheet', 'update_cells', 'create_spreadsheet'],
    supportedEvents: ['Row Added', 'Cell Modified'],
    supportedActions: [
      { id: 'sheets_append_row', name: 'Append Row', description: 'Insert structured row into spreadsheet' },
      { id: 'sheets_read_data', name: 'Read Sheet Rows', description: 'Fetch records from specified range' }
    ]
  },
  {
    provider: 'google_tasks',
    name: 'Google Tasks',
    type: 'native',
    icon: 'i-simple-icons:googletasks',
    category: 'google',
    description: 'Track client action items, set deadlines, and manage daily deliverables.',
    capabilities: ['create_task', 'complete_task', 'list_tasks'],
    supportedEvents: ['Task Created', 'Task Due'],
    supportedActions: [
      { id: 'tasks_create_task', name: 'Create Task', description: 'Add a new task with due date' }
    ]
  }
]

export const COMPOSIO_INTEGRATIONS: UnifiedIntegrationDefinition[] = POPULAR_COMPOSIO_TOOLKITS.map(tk => ({
  provider: tk.slug,
  name: tk.name,
  type: 'composio' as const,
  icon: tk.icon,
  category: tk.category,
  description: tk.description,
  capabilities: tk.popularActions.map(a => a.slug),
  supportedEvents: [`New ${tk.name} Activity`, `Webhook Trigger`],
  supportedActions: tk.popularActions.map(a => ({
    id: a.slug,
    name: a.name,
    description: a.description
  }))
}))

export const ALL_INTEGRATIONS_CATALOG: UnifiedIntegrationDefinition[] = [
  ...NATIVE_GOOGLE_INTEGRATIONS,
  ...COMPOSIO_INTEGRATIONS
]

export interface ResolvedUserIntegration {
  provider: string
  name: string
  type: 'native' | 'composio' | 'custom'
  icon: string
  category: IntegrationCategory
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

/**
 * Get all integrations for a user, merging native Firestore configurations
 * and Composio connected accounts.
 */

const AUTHENTIC_LINKS: Record<string, { website: string; privacy: string; terms: string }> = {
  'github': { website: 'https://github.com', privacy: 'https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement', terms: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service' },
  'microsoft_teams': { website: 'https://www.microsoft.com/en-us/microsoft-teams', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'outlook': { website: 'https://outlook.live.com', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'one_drive': { website: 'https://www.microsoft.com/en-us/microsoft-365/onedrive/online-cloud-storage', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'slack': { website: 'https://slack.com', privacy: 'https://slack.com/trust/privacy/privacy-policy', terms: 'https://slack.com/terms-of-service' },
  'gmail': { website: 'https://workspace.google.com/products/gmail/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_drive': { website: 'https://workspace.google.com/products/drive/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_calendar': { website: 'https://workspace.google.com/products/calendar/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_docs': { website: 'https://workspace.google.com/products/docs/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_sheets': { website: 'https://workspace.google.com/products/sheets/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'google_tasks': { website: 'https://workspace.google.com/', privacy: 'https://policies.google.com/privacy', terms: 'https://policies.google.com/terms' },
  'notion': { website: 'https://notion.so', privacy: 'https://www.notion.so/privacy', terms: 'https://www.notion.so/terms' },
  'linear': { website: 'https://linear.app', privacy: 'https://linear.app/privacy', terms: 'https://linear.app/terms' },
  'jira': { website: 'https://www.atlassian.com/software/jira', privacy: 'https://www.atlassian.com/legal/privacy-policy', terms: 'https://www.atlassian.com/legal/cloud-terms-of-service' },
  'trello': { website: 'https://trello.com', privacy: 'https://www.atlassian.com/legal/privacy-policy', terms: 'https://www.atlassian.com/legal/cloud-terms-of-service' },
  'asana': { website: 'https://asana.com', privacy: 'https://asana.com/terms#privacy-policy', terms: 'https://asana.com/terms' },
  'salesforce': { website: 'https://www.salesforce.com', privacy: 'https://www.salesforce.com/company/privacy/', terms: 'https://www.salesforce.com/company/legal/agreements/' },
  'airtable': { website: 'https://airtable.com', privacy: 'https://airtable.com/privacy', terms: 'https://airtable.com/terms' },
  'zendesk': { website: 'https://www.zendesk.com', privacy: 'https://www.zendesk.com/company/agreements-and-terms/privacy-notice/', terms: 'https://www.zendesk.com/company/agreements-and-terms/master-subscription-agreement/' },
  'stripe': { website: 'https://stripe.com', privacy: 'https://stripe.com/privacy', terms: 'https://stripe.com/legal/end-users' },
  'excel': { website: 'https://www.microsoft.com/en-us/microsoft-365/excel', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'word': { website: 'https://www.microsoft.com/en-us/microsoft-365/word', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'powerpoint': { website: 'https://www.microsoft.com/en-us/microsoft-365/powerpoint', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'powerbi': { website: 'https://powerbi.microsoft.com', privacy: 'https://privacy.microsoft.com/en-us/privacystatement', terms: 'https://www.microsoft.com/en-us/legal/terms-of-use' },
  'gitlab': { website: 'https://about.gitlab.com', privacy: 'https://about.gitlab.com/privacy/', terms: 'https://about.gitlab.com/terms/' },
  'hubspot': { website: 'https://www.hubspot.com', privacy: 'https://legal.hubspot.com/privacy-policy', terms: 'https://legal.hubspot.com/terms-of-service' },
  'clickup': { website: 'https://clickup.com', privacy: 'https://clickup.com/privacy', terms: 'https://clickup.com/terms' }
}

export async function getResolvedUserIntegrations(userId: string): Promise<ResolvedUserIntegration[]> {
  const composioConfigured = isComposioConfigured()
  // The only source of truth for "connected" is the user's own active Composio accounts.
  // A failed lookup throws: reporting every app as "not connected" would be a lie.
  const connections = composioConfigured ? await listComposioUserConnections(userId) : []

  return ALL_INTEGRATIONS_CATALOG.map((item) => {
    const conn = connections.find(c => c.toolkitSlug === item.provider && c.status === 'ACTIVE')
    return {
      provider: item.provider,
      name: item.name,
      type: item.type,
      icon: item.icon,
      category: item.category,
      status: conn ? 'connected' : 'disconnected',
      account: conn ? (conn.accountName || `Connected (${item.name})`) : 'Not connected',
      connectionId: conn?.id,
      capabilities: item.capabilities,
      description: item.description,
      supportedEventsCount: item.supportedEvents?.length || 0,
      supportedActionsCount: item.supportedActions?.length || 0,
      externalLinks: AUTHENTIC_LINKS[item.provider],
      canConnect: composioConfigured
    } satisfies ResolvedUserIntegration
  })
}

/**
 * Execute an action on a connected service. Nothing is simulated: the result reflects what the
 * provider really did, or why it could not be done.
 */
export async function executeIntegratedAction(
  userId: string,
  provider: string,
  actionId: string,
  parameters: Record<string, any>,
  opts: { abortSignal?: AbortSignal } = {}
): Promise<{
  success: boolean
  authRequired?: boolean
  authUrl?: string
  output: any
  message?: string
}> {
  // Toolkits missing from our catalog still work through Composio when the slug looks valid;
  // the connection check and tool lookup below reject anything that does not really exist.
  const definition = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === provider)
    ?? (/^[a-z0-9][a-z0-9_-]{1,39}$/.test(provider) ? { provider, name: provider.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), supportedActions: undefined } : null)
  if (!definition) {
    return { success: false, output: null, message: `Unknown integration provider: "${provider}"` }
  }

  const action = definition.supportedActions?.find(a => a.id === actionId)
  const { instruction: explicit, inputs, ...rest } = parameters ?? {}
  const details = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== ''))

  const lines: string[] = []
  if (typeof explicit === 'string' && explicit.trim()) {
    lines.push(explicit.trim())
  } else if (action) {
    lines.push(`${action.name}: ${action.description}.`)
  } else {
    lines.push(`Perform the action "${actionId}".`)
  }
  if (Object.keys(details).length) lines.push(`Settings: ${JSON.stringify(details)}`)
  if (inputs && Object.keys(inputs).length) lines.push(`<untrusted_workflow_data>\n${JSON.stringify(inputs).slice(0, 6000)}\n</untrusted_workflow_data>`)

  try {
    const res = await runIntegrationInstruction({
      userId,
      provider,
      providerName: definition.name,
      instruction: lines.join('\n'),
      abortSignal: opts.abortSignal
    })
    return {
      success: res.success,
      authRequired: res.authRequired,
      authUrl: res.authUrl,
      output: res.output,
      message: res.message
    }
  } catch (err: any) {
    return { success: false, output: null, message: `${definition.name} action failed: ${err?.message || 'unknown error'}` }
  }
}
