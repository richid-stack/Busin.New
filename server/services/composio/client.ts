import { Composio } from '@composio/core'
import { composioToolkitSlug, providerFromToolkitSlug } from '../integrations/slugs'

let composioClient: Composio | null = null

export function getComposioApiKey(): string | null {
  return process.env.COMPOSIO_API_KEY || null
}

export function isComposioConfigured(): boolean {
  return Boolean(getComposioApiKey())
}

export function getComposioClient(): Composio | null {
  const apiKey = getComposioApiKey()
  if (!apiKey) {
    return null
  }
  if (!composioClient) {
    composioClient = new Composio({ apiKey })
  }
  return composioClient
}

export interface ComposioConnectionInfo {
  id: string
  userId: string
  appUniqueId?: string
  toolkitSlug: string
  status: 'ACTIVE' | 'INITIATED' | 'FAILED' | 'EXPIRED' | 'REVOKED'
  accountName?: string
  createdAt?: string
  updatedAt?: string
}

export interface SupportedThirdPartyToolkit {
  slug: string
  name: string
  icon: string
  description: string
  category: 'communication' | 'productivity' | 'project_management' | 'crm' | 'developer'
  popularActions: Array<{ slug: string; name: string; description: string }>
}

export const SUPPORTED_THIRD_PARTY_TOOLKITS: SupportedThirdPartyToolkit[] = [
  {
    slug: 'slack',
    name: 'Slack',
    icon: 'i-logos-slack-icon',
    description: 'Send messages, alert channels, create canvases, and manage team communication.',
    category: 'communication',
    popularActions: [
      { slug: 'slack_send_message', name: 'Send Message', description: 'Post a notification or message to any Slack channel' },
      { slug: 'slack_create_channel', name: 'Create Channel', description: 'Create a dedicated project or client channel' },
      { slug: 'slack_add_reaction', name: 'Add Reaction', description: 'React with emoji to confirm workflow processing' }
    ]
  },
  {
    slug: 'discord',
    name: 'Discord',
    icon: 'i-logos-discord-icon',
    description: 'Post rich embeds, announcements, and channel messages to Discord servers.',
    category: 'communication',
    popularActions: [
      { slug: 'discord_send_message', name: 'Send Message', description: 'Send automated messages to a Discord channel' },
      { slug: 'discord_create_guild_channel', name: 'Create Channel', description: 'Create channels dynamically for incoming clients' }
    ]
  },
  {
    slug: 'notion',
    name: 'Notion',
    icon: 'i-logos-notion-icon',
    description: 'Create pages, append databases, document meetings, and track requirements.',
    category: 'productivity',
    popularActions: [
      { slug: 'notion_create_page', name: 'Create Page', description: 'Create a new project document or meeting note' },
      { slug: 'notion_query_database', name: 'Query Database', description: 'Fetch task or project status records' },
      { slug: 'notion_update_database_item', name: 'Update Database Item', description: 'Update CRM or backlog items in Notion' }
    ]
  },
  {
    slug: 'linear',
    name: 'Linear',
    icon: 'i-logos-linear-icon',
    description: 'File bug reports, triage feature requests, and sync engineering issues.',
    category: 'project_management',
    popularActions: [
      { slug: 'linear_create_issue', name: 'Create Issue', description: 'File prioritized engineering tickets directly from workflows' },
      { slug: 'linear_update_issue', name: 'Update Issue', description: 'Mark issues in-progress or attach summaries' },
      { slug: 'linear_list_issues', name: 'List Issues', description: 'Query team sprint backlog and status' }
    ]
  },
  {
    slug: 'jira',
    name: 'Jira',
    icon: 'i-logos-jira',
    description: 'Create sprint backlog items, update ticket workflows, and track deliverables.',
    category: 'project_management',
    popularActions: [
      { slug: 'jira_create_issue', name: 'Create Issue', description: 'Create Jira tasks and epics from incoming events' },
      { slug: 'jira_add_comment', name: 'Add Comment', description: 'Append execution summaries and deliverables to Jira cards' }
    ]
  },
  {
    slug: 'github',
    name: 'GitHub',
    icon: 'i-logos-github-icon',
    description: 'Manage repositories, create issues, pull requests, and trigger CI workflows.',
    category: 'developer',
    popularActions: [
      { slug: 'github_create_issue', name: 'Create Issue', description: 'Open bug reports or feature issues in GitHub repos' },
      { slug: 'github_create_pull_request', name: 'Create PR', description: 'Open pull requests with generated changes' },
      { slug: 'github_dispatch_workflow', name: 'Dispatch Workflow', description: 'Trigger GitHub Actions CI/CD pipelines' }
    ]
  },
  {
    slug: 'gitlab',
    name: 'GitLab',
    icon: 'i-logos-gitlab',
    description: 'Manage merge requests, pipeline triggers, and GitLab project issues.',
    category: 'developer',
    popularActions: [
      { slug: 'gitlab_create_issue', name: 'Create Issue', description: 'Create tracking tickets in GitLab projects' },
      { slug: 'gitlab_create_merge_request', name: 'Create Merge Request', description: 'Open merge requests with pipeline triggers' }
    ]
  },
  {
    slug: 'trello',
    name: 'Trello',
    icon: 'i-logos-trello',
    description: 'Add cards to Kanban boards, manage checklists, and update task statuses.',
    category: 'project_management',
    popularActions: [
      { slug: 'trello_create_card', name: 'Create Card', description: 'Add new client onboarding or bug card to Trello list' },
      { slug: 'trello_add_comment', name: 'Add Comment', description: 'Log agent activity on Trello cards' }
    ]
  },
  {
    slug: 'asana',
    name: 'Asana',
    icon: 'i-logos-asana-icon',
    description: 'Assign tasks, set due dates, and update project milestones.',
    category: 'project_management',
    popularActions: [
      { slug: 'asana_create_task', name: 'Create Task', description: 'Create tasks assigned to team members' },
      { slug: 'asana_update_task', name: 'Update Task', description: 'Complete or update milestone dates' }
    ]
  },
  {
    slug: 'clickup',
    name: 'ClickUp',
    icon: 'i-logos-clickup-icon',
    description: 'Sync workspace tasks, custom fields, docs, and time estimates.',
    category: 'project_management',
    popularActions: [
      { slug: 'clickup_create_task', name: 'Create Task', description: 'Create prioritized tasks in ClickUp spaces' }
    ]
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    icon: 'i-logos-hubspot',
    description: 'Sync customer CRM contacts, log deals, and track lead activities.',
    category: 'crm',
    popularActions: [
      { slug: 'hubspot_create_contact', name: 'Create Contact', description: 'Capture incoming leads directly into HubSpot' },
      { slug: 'hubspot_create_deal', name: 'Create Deal', description: 'Register sales pipeline opportunities' }
    ]
  },
  {
    slug: 'salesforce',
    name: 'Salesforce',
    icon: 'i-logos-salesforce',
    description: 'Manage accounts, leads, opportunities, and enterprise CRM records.',
    category: 'crm',
    popularActions: [
      { slug: 'salesforce_create_lead', name: 'Create Lead', description: 'Record client inquiries into Salesforce Leads' }
    ]
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    icon: 'i-logos-airtable',
    description: 'Create records, query relational bases, and sync spreadsheet data.',
    category: 'productivity',
    popularActions: [
      { slug: 'airtable_create_record', name: 'Create Record', description: 'Append rows to custom relational Airtable bases' },
      { slug: 'airtable_list_records', name: 'List Records', description: 'Fetch and filter rows from tables' }
    ]
  },
  // --- Microsoft 365 & Enterprise Productivity Tools (Supported by Composio Managed Auth) ---
  {
    slug: 'microsoft_teams',
    name: 'Microsoft Teams',
    icon: 'i-logos-microsoft-teams',
    description: 'Send channel alerts, direct messages, meeting notifications, and adaptive cards.',
    category: 'communication',
    popularActions: [
      { slug: 'MICROSOFT_TEAMS_SEND_MESSAGE', name: 'Send Channel Alert', description: 'Send automated alerts and updates to team channels' },
      { slug: 'MICROSOFT_TEAMS_SEND_ADAPTIVE_CARD', name: 'Post Adaptive Card', description: 'Post interactive adaptive cards to chats and channels' },
      { slug: 'MICROSOFT_TEAMS_CREATE_MEETING', name: 'Create Meeting', description: 'Schedule online Teams video conferences and sync invites' }
    ]
  },
  {
    slug: 'outlook',
    name: 'Microsoft Outlook & Calendar',
    icon: 'i-logos-microsoft-icon',
    description: 'Manage enterprise emails, calendar meetings, contacts, rules, and inbox notifications.',
    category: 'communication',
    popularActions: [
      { slug: 'OUTLOOK_SEND_EMAIL', name: 'Send Enterprise Email', description: 'Draft and send enterprise emails to clients and team members' },
      { slug: 'OUTLOOK_CREATE_EVENT', name: 'Schedule Calendar Invite', description: 'Schedule meetings and send Outlook calendar invites' },
      { slug: 'OUTLOOK_ADD_MAIL_ATTACHMENT', name: 'Add Attachment', description: 'Attach reports and generated assets to emails' }
    ]
  },
  {
    slug: 'one_drive',
    name: 'Microsoft OneDrive',
    icon: 'i-logos-microsoft-onedrive',
    description: 'Upload files, manage cloud folders, generate shareable links, and sync documents.',
    category: 'productivity',
    popularActions: [
      { slug: 'ONE_DRIVE_UPLOAD_FILE', name: 'Upload Document', description: 'Upload generated reports and documents to OneDrive' },
      { slug: 'ONE_DRIVE_CREATE_LINK', name: 'Generate Share Link', description: 'Generate view or edit links for uploaded files' },
      { slug: 'ONE_DRIVE_DOWNLOAD_FILE', name: 'Fetch File', description: 'Fetch documents and files from enterprise cloud storage' }
    ]
  },

  {
    slug: 'excel',
    name: 'Microsoft Excel',
    icon: 'i-logos-microsoft-excel',
    description: 'Create spreadsheets, update workbook rows, and analyze financial models.',
    category: 'productivity',
    popularActions: [
      { slug: 'EXCEL_ADD_ROW', name: 'Append Row', description: 'Insert structured row into enterprise spreadsheet' },
      { slug: 'EXCEL_GET_WORKSHEET', name: 'Read Worksheet', description: 'Fetch records from specified range' },
      { slug: 'EXCEL_CREATE_WORKBOOK', name: 'Create Workbook', description: 'Create a new Excel workbook' }
    ]
  },
  {
    slug: 'word',
    name: 'Microsoft Word',
    icon: 'i-logos-microsoft-word',
    description: 'Generate enterprise proposals, technical requirements, and legal documents.',
    category: 'productivity',
    popularActions: [
      { slug: 'WORD_CREATE_DOCUMENT', name: 'Create Document', description: 'Create a new enterprise Word document' },
      { slug: 'WORD_APPEND_TEXT', name: 'Append Content', description: 'Insert text into a Word document' }
    ]
  },
  {
    slug: 'powerpoint',
    name: 'Microsoft PowerPoint',
    icon: 'i-logos-microsoft-powerpoint',
    description: 'Generate presentation slides, executive briefings, and deck templates.',
    category: 'productivity',
    popularActions: [
      { slug: 'POWERPOINT_CREATE_PRESENTATION', name: 'Create Presentation', description: 'Create a new presentation deck' },
      { slug: 'POWERPOINT_ADD_SLIDE', name: 'Add Slide', description: 'Append a slide to a presentation' }
    ]
  },
  {
    slug: 'powerbi',
    name: 'Microsoft PowerBI',
    icon: 'i-logos-microsoft-power-bi',
    description: 'Trigger dataset refreshes, export visual reports, and manage BI dashboards.',
    category: 'productivity',
    popularActions: [
      { slug: 'POWERBI_REFRESH_DATASET', name: 'Refresh Dataset', description: 'Trigger a data refresh on a PowerBI dataset' },
      { slug: 'POWERBI_EXPORT_REPORT', name: 'Export Report', description: 'Export a PowerBI report to PDF or Image' }
    ]
  },

  // --- Popular Productivity & Marketing Tools ---
  {
    slug: 'zendesk',
    name: 'Zendesk',
    icon: 'i-logos-zendesk-icon',
    description: 'Create customer support tickets, append internal notes, and monitor escalations.',
    category: 'crm',
    popularActions: [
      { slug: 'zendesk_create_ticket', name: 'Create Support Ticket', description: 'Open prioritized customer inquiries' },
      { slug: 'zendesk_add_comment', name: 'Add Ticket Comment', description: 'Append resolution notes to tickets' }
    ]
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    icon: 'i-logos-stripe',
    description: 'Query customer payments, invoices, subscriptions, and charge records.',
    category: 'crm',
    popularActions: [
      { slug: 'stripe_list_charges', name: 'List Charges', description: 'Inspect recent client payment transactions' },
      { slug: 'stripe_create_customer', name: 'Create Customer', description: 'Register new billing profiles' }
    ]
  }
]

/**
 * Fetch all active connected accounts for a specific user ID via Composio
 */
export async function getComposioUserConnections(userId: string): Promise<ComposioConnectionInfo[]> {
  const client = getComposioClient()
  if (!client) {
    return []
  }

  try {
    const res = await client.connectedAccounts.list({
      userIds: [userId]
    })

    const items = (res.items || []) as any[]
    return items
      // Defence in depth: never surface another user's connection.
      .filter(item => !item.userId || item.userId === userId)
      .map(item => ({
        id: item.id,
        userId,
        appUniqueId: item.appUniqueId,
        toolkitSlug: providerFromToolkitSlug(item.toolkit?.slug || item.toolkitSlug || item.appName || ''),
        status: item.status || 'ACTIVE',
        accountName: item.params?.user_info?.name || item.params?.user_info?.email || item.integrationName || item.toolkit?.name,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
  } catch (err) {
    console.warn(`[ComposioService] Failed to list connections for user ${userId}:`, err)
    return []
  }
}

/**
 * Create a connection link for a third-party service through Composio
 */
export async function createComposioConnectionLink(
  userId: string,
  toolkitSlug: string,
  callbackUrl?: string
): Promise<{ redirectUrl: string; connectionRequestId?: string; authConfigId?: string }> {
  const client = getComposioClient()
  const apiKey = getComposioApiKey()

  if (!client || !apiKey) {
    throw new Error('Composio is not configured. Please provide COMPOSIO_API_KEY.')
  }

  const normalizedSlug = composioToolkitSlug(toolkitSlug)

  // 1. Discover or automatically create the appropriate auth config ID for this toolkit
  let authConfigId: string | null = null
  try {
    const authConfigs = await client.authConfigs.list({
      toolkit: normalizedSlug,
      isComposioManaged: true
    })

    const items = (authConfigs as any).items || []
    if (items.length > 0) {
      authConfigId = items[0].id
    }
  } catch (err) {
    console.warn(`[ComposioService] Error fetching authConfig for ${normalizedSlug} via SDK, falling back to REST:`, err)
  }

  // Fallback direct REST discovery if needed
  if (!authConfigId) {
    try {
      const restRes = await fetch(`https://backend.composio.dev/api/v3/auth_configs?toolkit_slug=${encodeURIComponent(normalizedSlug)}&is_composio_managed=true`, {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      })
      if (restRes.ok) {
        const json = await restRes.json()
        const items = json.items || []
        if (items.length > 0) {
          authConfigId = items[0].id
        }
      }
    } catch (e) {
      console.warn(`[ComposioService] REST fallback for authConfig query failed:`, e)
    }
  }

  // If no auth config exists yet in user project, dynamically auto-provision standard Composio managed auth
  if (!authConfigId) {
    try {
      const createRes = await fetch('https://backend.composio.dev/api/v3/auth_configs', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          toolkit: {
            slug: normalizedSlug
          }
        })
      })
      if (createRes.ok) {
        const createdJson = await createRes.json()
        if (createdJson?.auth_config?.id) {
          authConfigId = createdJson.auth_config.id
          console.info(`[ComposioService] Auto-provisioned managed auth config for ${normalizedSlug}: ${authConfigId}`)
        }
      }
    } catch (e) {
      console.warn(`[ComposioService] Dynamic auth config provisioning failed for ${normalizedSlug}:`, e)
    }
  }

  if (!authConfigId) {
    throw new Error(`No authentication configuration found for "${toolkitSlug}". Ensure this integration is enabled in your Composio dashboard.`)
  }

  // 2. Generate connection link using composio.connectedAccounts.link
  try {
    const connectionRequest = await client.connectedAccounts.link(userId, authConfigId, {
      callbackUrl,
      allowMultiple: true
    })

    if (!connectionRequest.redirectUrl) {
      throw new Error('Composio did not return an authorization URL.')
    }
    return {
      redirectUrl: connectionRequest.redirectUrl,
      connectionRequestId: connectionRequest.id,
      authConfigId
    }
  } catch (linkErr: any) {
    // Attempt REST fallback if link method encountered an edge case
    const restRes = await fetch('https://backend.composio.dev/api/v3.1/connected_accounts/link', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: userId,
        auth_config_id: authConfigId,
        callback_url: callbackUrl,
        allow_multiple: true
      })
    })

    if (!restRes.ok) {
      const errBody = await restRes.text().catch(() => '')
      throw new Error(`Failed to generate integration connection link: ${linkErr?.message || errBody || 'Unknown error'}`)
    }

    const data = await restRes.json()
    const redirectUrl = data.redirect_url || data.redirectUrl
    if (!redirectUrl) {
      throw new Error('Composio did not return an authorization URL.')
    }
    return {
      redirectUrl,
      connectionRequestId: data.id || data.connection_request_id,
      authConfigId
    }
  }
}

/**
 * Disconnect/delete a connected account
 */
export async function deleteComposioConnection(userId: string, connectionId: string): Promise<boolean> {
  const client = getComposioClient()
  if (!client) return false

  try {
    // Only connections that belong to this user can be removed.
    const mine = await getComposioUserConnections(userId)
    if (!mine.some(c => c.id === connectionId)) {
      throw new Error('Unauthorized: Connection belongs to a different user.')
    }
    await client.connectedAccounts.delete(connectionId)
    return true
  } catch (err) {
    console.warn(`[ComposioService] Failed to delete connection ${connectionId}:`, err)
    return false
  }
}

/**
 * The user's active connection for a provider, or null. Only ever looks at this user's own accounts.
 */
export async function getActiveComposioConnection(userId: string, provider: string): Promise<ComposioConnectionInfo | null> {
  const slug = providerFromToolkitSlug(composioToolkitSlug(provider))
  const connections = await getComposioUserConnections(userId)
  return connections.find(c => c.toolkitSlug === slug && c.status === 'ACTIVE') ?? null
}

export const POPULAR_COMPOSIO_TOOLKITS: SupportedThirdPartyToolkit[] = SUPPORTED_THIRD_PARTY_TOOLKITS
