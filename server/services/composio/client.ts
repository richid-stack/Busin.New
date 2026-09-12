import { Composio } from '@composio/core'

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
    description: 'Manage accounts, leads, opportunities, and enterprise enterprise records.',
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
      entityIds: [userId]
    })

    const items = res.items || []
    return items.map((item: any) => ({
      id: item.id,
      userId: item.userId || userId,
      appUniqueId: item.appUniqueId,
      toolkitSlug: (item.toolkit?.slug || item.toolkitSlug || item.appName || '').toLowerCase(),
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

  const normalizedSlug = toolkitSlug.toLowerCase().trim()

  // 1. Discover the appropriate auth config ID for this toolkit
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
      console.warn(`[ComposioService] REST fallback for authConfig failed:`, e)
    }
  }

  if (!authConfigId) {
    throw new Error(`No authentication configuration found for "${toolkitSlug}". Ensure this integration is enabled in your dashboard.`)
  }

  // 2. Generate connection link using composio.connectedAccounts.link
  try {
    const connectionRequest = await client.connectedAccounts.link(userId, authConfigId, {
      callbackUrl,
      allowMultiple: true
    })

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
    return {
      redirectUrl: data.redirect_url || data.redirectUrl,
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
    // Verify ownership first
    const conn = await client.connectedAccounts.get(connectionId)
    if (conn && conn.userId && conn.userId !== userId) {
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
 * Execute a Composio tool for a specific user.
 * Returns structured result or AUTH_REQUIRED if user is unauthenticated.
 */
export async function executeComposioToolSafely(
  userId: string,
  toolSlug: string,
  args: Record<string, any>
): Promise<{
  success: boolean
  authRequired?: boolean
  authUrl?: string
  result?: any
  error?: string
}> {
  const client = getComposioClient()
  const apiKey = getComposioApiKey()

  if (!client || !apiKey) {
    return {
      success: false,
      error: 'Integration provider not configured (missing COMPOSIO_API_KEY).'
    }
  }

  try {
    const execution = await client.tools.execute(toolSlug, {
      entityId: userId,
      arguments: args,
      dangerouslySkipVersionCheck: true
    })

    return {
      success: true,
      result: execution
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err)

    // Check if error is due to missing authentication / unlinked account
    if (
      errMsg.includes('CONNECTED_ACCOUNT_NOT_FOUND') ||
      errMsg.includes('not authenticated') ||
      errMsg.includes('No connected account') ||
      errMsg.includes('AUTH_REQUIRED')
    ) {
      // Determine toolkit from tool slug (e.g. "slack_send_message" -> "slack")
      const toolkitSlug = toolSlug.split('_')[0]
      let authUrl: string | undefined
      try {
        const link = await createComposioConnectionLink(userId, toolkitSlug)
        authUrl = link.redirectUrl
      } catch {
        // ignore if link cannot be pre-generated
      }

      return {
        success: false,
        authRequired: true,
        authUrl,
        error: `Authentication required for ${toolkitSlug}. Please connect your account to proceed.`
      }
    }

    return {
      success: false,
      error: errMsg
    }
  }
}

const userSessions = new Map<string, any>()

/**
 * Get or create a runtime Composio session for a specific application user.
 * Preserves user identity and tool state per session.
 */
export async function getUserComposioSession(userId: string) {
  const client = getComposioClient()
  if (!client) return null

  if (userSessions.has(userId)) {
    return userSessions.get(userId)
  }

  try {
    const session = await client.create(userId)
    userSessions.set(userId, session)
    return session
  } catch (err) {
    console.error(`[ComposioService] Error creating session for user ${userId}:`, err)
    return null
  }
}

/**
 * Maps common third-party toolkits to a safe, read-only verification tool
 */
export function getSafeTestToolForToolkit(toolkitSlug: string): {
  toolSlug: string
  name: string
  description: string
  args: Record<string, any>
} {
  const normalized = toolkitSlug.toLowerCase().trim()
  switch (normalized) {
    case 'github':
      return {
        toolSlug: 'GITHUB_GET_THE_AUTHENTICATED_USER',
        name: 'Get Authenticated User Profile',
        description: 'Safely reads the logged-in GitHub profile (username, avatar, repository count).',
        args: {}
      }
    case 'slack':
      return {
        toolSlug: 'SLACK_TEST_AUTH',
        name: 'Test Slack Authentication',
        description: 'Validates Slack bot and user credentials, returning workspace ID and user details.',
        args: {}
      }
    case 'gmail':
      return {
        toolSlug: 'GMAIL_GET_PROFILE',
        name: 'Get Gmail Profile',
        description: 'Fetches the authenticated email address, history ID, and total messages count.',
        args: {}
      }
    case 'discord':
      return {
        toolSlug: 'DISCORD_GET_MY_USER',
        name: 'Get Current Discord User',
        description: 'Returns the connected Discord tag, avatar, and user ID.',
        args: {}
      }
    case 'notion':
      return {
        toolSlug: 'NOTION_MCP_NOTION_SEARCH',
        name: 'Notion Search Workspace',
        description: 'Performs a read-only search across accessible Notion workspace pages.',
        args: { query: '' }
      }
    default:
      return {
        toolSlug: `${normalized.toUpperCase()}_TEST_AUTH`,
        name: `Verify ${toolkitSlug}`,
        description: `Perform safe read-only verification for ${toolkitSlug}.`,
        args: {}
      }
  }
}

/**
 * Execute a safe read-only tool call using the user's Composio session.
 * If not connected, returns the Connect Link and authorization instructions.
 */
export async function executeSafeVerificationTool(
  userId: string,
  toolkitSlug: string
): Promise<{
  success: boolean
  connected: boolean
  toolSlug: string
  toolName: string
  logId?: string
  result?: any
  redirectUrl?: string
  message: string
}> {
  const session = await getUserComposioSession(userId)
  const safeTool = getSafeTestToolForToolkit(toolkitSlug)

  if (!session) {
    return {
      success: false,
      connected: false,
      toolSlug: safeTool.toolSlug,
      toolName: safeTool.name,
      message: 'Composio session could not be initialized. Check COMPOSIO_API_KEY.'
    }
  }

  try {
    const execution = await session.execute(safeTool.toolSlug, safeTool.args)
    return {
      success: true,
      connected: true,
      toolSlug: safeTool.toolSlug,
      toolName: safeTool.name,
      logId: execution?.logId,
      result: execution?.data || execution,
      message: `Successfully executed ${safeTool.name} via Composio Platform session!`
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err)

    // Check if error is due to missing active connection
    if (
      errMsg.includes('No active connection found') ||
      errMsg.includes('ToolRouterV2_NoActiveConnection') ||
      errMsg.includes('CONNECTED_ACCOUNT_NOT_FOUND')
    ) {
      try {
        const connectRes = await session.execute('COMPOSIO_MANAGE_CONNECTIONS', {
          toolkits: [toolkitSlug.toLowerCase()]
        })

        const toolkitRes = connectRes?.data?.results?.[toolkitSlug.toLowerCase()]
        const redirectUrl = toolkitRes?.redirect_url

        return {
          success: false,
          connected: false,
          toolSlug: safeTool.toolSlug,
          toolName: safeTool.name,
          logId: connectRes?.logId,
          redirectUrl,
          message: `No active connection found for ${toolkitSlug}. Please authorize using the Connect link.`
        }
      } catch (connErr: any) {
        return {
          success: false,
          connected: false,
          toolSlug: safeTool.toolSlug,
          toolName: safeTool.name,
          message: `Connection required: ${connErr?.message || errMsg}`
        }
      }
    }

    return {
      success: false,
      connected: true,
      toolSlug: safeTool.toolSlug,
      toolName: safeTool.name,
      message: errMsg
    }
  }
}


export const POPULAR_COMPOSIO_TOOLKITS: SupportedThirdPartyToolkit[] = [
  {
    slug: 'slack',
    name: 'Slack',
    icon: 'i-logos-slack-icon',
    description: 'Post channel notifications, send direct messages, and listen for incoming mentions.',
    category: 'communication',
    popularActions: [
      { slug: 'slack_send_message', name: 'Post Message', description: 'Send a message to a channel' },
      { slug: 'slack_send_dm', name: 'Send Direct Message', description: 'Send a DM to a colleague' }
    ]
  },
  {
    slug: 'github',
    name: 'GitHub',
    icon: 'i-logos-github-icon',
    description: 'Create issues, review pull requests, create comments, and watch repository events.',
    category: 'developer',
    popularActions: [
      { slug: 'github_create_issue', name: 'Create Issue', description: 'File a new issue on a repo' },
      { slug: 'github_create_comment', name: 'Add Issue Comment', description: 'Comment on an issue or PR' }
    ]
  },
  {
    slug: 'notion',
    name: 'Notion',
    icon: 'i-logos-notion-icon',
    description: 'Create database entries, update wiki documentation, and sync onboarding cards.',
    category: 'productivity',
    popularActions: [
      { slug: 'notion_create_page', name: 'Create Page', description: 'Create a new Notion doc/page' },
      { slug: 'notion_update_database', name: 'Update Database', description: 'Add row to Notion database' }
    ]
  },
  {
    slug: 'linear',
    name: 'Linear',
    icon: 'i-logos-linear-icon',
    description: 'Create tracking tickets, manage cycles, and update issue progress.',
    category: 'project_management',
    popularActions: [
      { slug: 'linear_create_issue', name: 'Create Issue', description: 'File engineering ticket' },
      { slug: 'linear_update_issue', name: 'Update Issue', description: 'Change status or priority' }
    ]
  },
  {
    slug: 'discord',
    name: 'Discord',
    icon: 'i-logos-discord-icon',
    description: 'Broadcast community messages, send embed alerts, and manage server announcements.',
    category: 'communication',
    popularActions: [
      { slug: 'discord_send_message', name: 'Send Message', description: 'Post alert to Discord channel' }
    ]
  }
]
