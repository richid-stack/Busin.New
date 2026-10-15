import { tool } from 'ai'
import { z } from 'zod'
import { createWorkflow, getWorkflow, saveWorkflowRun } from '../firebase'
import { executeWorkflowDAG, DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../workflowEngine'
import { getResolvedUserIntegrations, ALL_INTEGRATIONS_CATALOG, executeIntegratedAction } from '../../services/integrations/registry'
import { createComposioConnectionLink } from '../../services/composio/client'

export const createWorkflowCreateTool = (userId: string) => tool({
  description: `Automatically create and provision a complete visual workflow in Workflow Studio.
Use this whenever the user asks to create an automation, pipeline, or connect Google Workspace (Gmail, Drive, Calendar, Docs, Sheets) or third-party apps (Slack, Discord, Notion, Linear, Jira, GitHub, Trello, Asana, etc.) to perform multi-step AI tasks.
This builds the topology, saves it to the database, and provides direct access to Workflow Studio.`,
  inputSchema: z.object({
    title: z.string().describe('The name of the workflow, e.g. "Client Onboarding Pipeline"'),
    description: z.string().describe('Short explanation of what the workflow automates'),
    triggerProvider: z.string().default('gmail').describe('Source event service (e.g. gmail, slack, github, webhook, schedule)'),
    triggerEvent: z.string().default('New Email Received').describe('Event name'),
    steps: z.array(z.object({
      id: z.string().describe('Unique slug ID, e.g. "ai-triage" or "action-slack"'),
      type: z.enum(['agent', 'action']).describe('agent for AI reasoning, action for service dispatch'),
      title: z.string().describe('Display title of this step'),
      subtitle: z.string().describe('Short description or model name, e.g. "Gemini 3.5 Flash" or "Action • Slack"'),
      prompt: z.string().optional().describe('System prompt for AI agent steps'),
      provider: z.string().optional().describe('Service provider for action steps (e.g. "google_drive", "slack", "notion", "linear", "jira", "discord", "gmail")'),
      connection: z.string().optional().describe('Account or workspace name')
    })).describe('Sequential or branching steps in this workflow')
  }),
  parameters: z.object({
    title: z.string().describe('The name of the workflow, e.g. "Client Onboarding Pipeline"'),
    description: z.string().describe('Short explanation of what the workflow automates'),
    triggerProvider: z.string().default('gmail').describe('Source event service (e.g. gmail, slack, github, webhook, schedule)'),
    triggerEvent: z.string().default('New Email Received').describe('Event name'),
    steps: z.array(z.object({
      id: z.string().describe('Unique slug ID, e.g. "ai-triage" or "action-slack"'),
      type: z.enum(['agent', 'action']).describe('agent for AI reasoning, action for service dispatch'),
      title: z.string().describe('Display title of this step'),
      subtitle: z.string().describe('Short description or model name, e.g. "Gemini 3.5 Flash" or "Action • Slack"'),
      prompt: z.string().optional().describe('System prompt for AI agent steps'),
      provider: z.string().optional().describe('Service provider for action steps (e.g. "google_drive", "slack", "notion", "linear", "jira", "discord", "gmail")'),
      connection: z.string().optional().describe('Account or workspace name')
    })).describe('Sequential or branching steps in this workflow')
  }),
  execute: async ({ title, description, triggerProvider, triggerEvent, steps }) => {
    try {
      // Build VueFlow nodes with automatic sensible canvas positions
      const triggerDef = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === triggerProvider)
      const nodes: any[] = [
        {
          id: 'trigger',
          type: 'trigger',
          position: { x: 100, y: 300 },
          data: {
            title: triggerProvider === 'gmail' ? 'New Client Email' : `${triggerDef?.name || (triggerProvider || 'custom').toUpperCase()} Event`,
            subtitle: `Trigger • ${triggerDef?.name || triggerProvider}`,
            icon: triggerDef?.icon || 'i-lucide-zap',
            provider: triggerProvider,
            event: triggerEvent,
            connection: 'Default Account'
          }
        }
      ]

      const edges: any[] = []
      let lastAgentId = 'trigger'

      steps.forEach((step, index) => {
        const xPos = 450 + (index * 400)
        const yPos = index % 2 === 0 ? 220 : 380

        let icon = 'i-lucide-box'
        let color = 'text-primary'

        if (step.type === 'agent') {
          icon = 'i-lucide-brain'
          color = index === 0 ? 'text-primary' : (index === 1 ? 'text-violet-500' : 'text-teal-500')
        } else if (step.provider) {
          const match = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === step.provider)
          if (match) {
            icon = match.icon
          }
        }

        nodes.push({
          id: step.id,
          type: step.type,
          position: { x: xPos, y: yPos },
          data: {
            title: step.title,
            subtitle: step.subtitle,
            icon,
            color,
            prompt: step.prompt,
            provider: step.provider,
            connection: step.connection || 'Default Account'
          }
        })

        // Connect from predecessor
        edges.push({
          id: `e-${lastAgentId}-${step.id}`,
          source: lastAgentId,
          target: step.id,
          animated: true,
          style: { stroke: 'var(--ui-primary)', strokeWidth: 2 }
        })

        if (step.type === 'agent') {
          lastAgentId = step.id
        }
      })

      const workflow = await createWorkflow({
        title,
        description,
        userId,
        nodes,
        edges,
        status: 'active'
      })

      return {
        success: true,
        workflowId: workflow.id,
        title: workflow.title,
        description: workflow.description,
        nodeCount: nodes.length,
        studioUrl: `/workflows?id=${workflow.id}`,
        message: `Workflow "${title}" has been provisioned with ${nodes.length} nodes and routed to Workflow Studio.`
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Failed to create workflow'
      }
    }
  }
})

export const createWorkflowRunTool = (userId: string) => tool({
  description: `Trigger a test run or active execution of an existing workflow. Executes all nodes using the AI engine and provides real-time outputs and logs.`,
  inputSchema: z.object({
    workflowId: z.string().default('client-onboarding-pipeline').describe('ID of the workflow to run'),
    inputSummary: z.string().optional().describe('Summary or text of test trigger event')
  }),
  parameters: z.object({
    workflowId: z.string().default('client-onboarding-pipeline').describe('ID of the workflow to run'),
    inputSummary: z.string().optional().describe('Summary or text of test trigger event')
  }),
  execute: async ({ workflowId, inputSummary }) => {
    try {
      let workflow = await getWorkflow(workflowId)
      if (workflow && workflow.userId !== userId) {
        return { success: false, error: 'Workflow not found' }
      }
      if (!workflow) {
        workflow = {
          id: workflowId,
          title: 'Client Onboarding Pipeline',
          description: 'Client Onboarding Pipeline',
          userId,
          status: 'active',
          nodes: DEFAULT_WORKFLOW_NODES,
          edges: DEFAULT_WORKFLOW_EDGES,
          createdAt: new Date()
        }
      }

      const inputPayload = inputSummary ? {
        email: {
          sender: 'client@example.com',
          subject: 'Custom Request',
          body: inputSummary
        }
      } : undefined

      const result = await executeWorkflowDAG(workflow, inputPayload, userId)

      const runRecord = await saveWorkflowRun(workflow.id, {
        workflowId: workflow.id,
        approvalNodeId: result.approvalNodeId,
        approvalPrompt: result.approvalPrompt,
        approvalData: result.approvalData,
        userId,
        status: result.status,
        input: inputPayload || {},
        output: result.outputs,
        logs: result.logs,
        durationMs: result.durationMs
      })

      return {
        success: true,
        runId: runRecord.id,
        workflowId: workflow.id,
        title: workflow.title,
        approvalPrompt: result.approvalPrompt,
        approvalData: result.approvalData,
        status: result.status,
        durationMs: result.durationMs,
        stepsExecuted: result.logs.length,
        outputs: result.outputs,
        summary: `Workflow "${workflow.title}" ran successfully in ${result.durationMs}ms across ${result.logs.length} nodes.`
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Failed to execute workflow'
      }
    }
  }
})

export const createIntegrationStatusTool = (userId: string) => tool({
  description: `Check the connection status and capabilities of integrated external services (Native Google: Gmail, Drive, Calendar, Docs, Sheets; and third-party services: Slack, Discord, Notion, Linear, Jira, GitHub).`,
  inputSchema: z.object({}),
  parameters: z.object({}),
execute: async () => {
    try {
      const integrations = await getResolvedUserIntegrations(userId)
      
      const enriched = await Promise.all(integrations.map(async i => {
        let authUrl = `/integrations/${i.provider}`
        if (i.type === 'composio' && i.status !== 'connected') {
          try {
            const link = await createComposioConnectionLink(userId, i.provider)
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
        readyForAutomation: enriched.some(i => i.status === 'connected')
      }
    } catch (err: any) {
      return {
        connectedServices: [],
        readyForAutomation: false,
        error: err?.message || 'Failed to load integrations'
      }
    }
  }
})

export function resolveIntegrationDefinition(providerSlug: string) {
  const norm = providerSlug.toLowerCase().trim().replace(/[- ]/g, '_')
  const exact = ALL_INTEGRATIONS_CATALOG.find(i => i.provider === norm || i.name.toLowerCase() === norm)
  if (exact) return exact

  // Popular alias and shorthand lookups
  if (norm === 'github' || norm === 'gh') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'github')
  if (norm === 'slack') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'slack')
  if (norm === 'gmail' || norm === 'mail' || norm === 'email') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'gmail')
  if (norm === 'drive' || norm === 'google_drive') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'google_drive')
  if (norm === 'sheets' || norm === 'google_sheets') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'google_sheets')
  if (norm === 'docs' || norm === 'google_docs') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'google_docs')
  if (norm === 'calendar' || norm === 'google_calendar') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'google_calendar')
  if (norm === 'tasks' || norm === 'google_tasks') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'google_tasks')
  if (norm === 'linear') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'linear')
  if (norm === 'notion') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'notion')
  if (norm === 'discord') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'discord')
  if (norm === 'jira') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'jira')
  if (norm === 'salesforce') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'salesforce')
  if (norm === 'airtable') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'airtable')
  if (norm === 'gitlab') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'gitlab')
  if (norm === 'trello') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'trello')
  if (norm === 'asana') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'asana')
  if (norm === 'teams' || norm === 'microsoft_teams') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'microsoft_teams')
  if (norm === 'outlook') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'outlook')
  if (norm === 'onedrive' || norm === 'one_drive') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'one_drive')
  if (norm === 'zendesk') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'zendesk')
  if (norm === 'stripe') return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === 'stripe')

  return null
}

export function createIntegrationExecuteTool(userId: string) {
  return tool({
    description: `Execute any action or operation on an integrated external service (e.g., GitHub, Slack, Gmail, Notion, Discord, Linear, Salesforce, Google Drive, Jira). 
Use this when the user asks you to interact with, create items in, read from, or automate any third-party app.
Provide the provider slug (e.g. 'github', 'slack', 'linear') and a natural language instruction of what you want to accomplish.`,
    inputSchema: z.object({
      provider: z.string().describe('The service provider slug, e.g. "github", "slack", "gmail", "salesforce", "linear", "notion"'),
      instruction: z.string().describe('Detailed natural language instruction of what to do (e.g. "Create a high priority issue titled User Login Bug with description...")')
    }),
    parameters: z.object({
      provider: z.string().describe('The service provider slug, e.g. "github", "slack", "gmail", "salesforce", "linear", "notion"'),
      instruction: z.string().describe('Detailed natural language instruction of what to do (e.g. "Create a high priority issue titled User Login Bug with description...")')
    }),
    execute: async ({ provider, instruction }) => {
      try {
        const resolvedDefinition = resolveIntegrationDefinition(provider)
        const targetSlug = resolvedDefinition?.provider || provider.toLowerCase().trim()
        const providerDisplayName = resolvedDefinition?.name || (targetSlug.charAt(0).toUpperCase() + targetSlug.slice(1))
        const providerIcon = resolvedDefinition?.icon || 'i-lucide-plug'
        const providerCategory = resolvedDefinition?.category || 'productivity'

        // 1. Check live connection status for this user
        const userIntegrations = await getResolvedUserIntegrations(userId).catch(() => [])
        const currentInteg = userIntegrations.find(i => i.provider === targetSlug)
        const isConnected = currentInteg?.status === 'connected'

        // 2. If NOT connected, trigger real authentication flow
        if (!isConnected) {
          let authUrl = `/integrations/${targetSlug}`
          if (resolvedDefinition?.type === 'composio' || !resolvedDefinition) {
            try {
              const link = await createComposioConnectionLink(userId, targetSlug)
              if (link.redirectUrl) {
                authUrl = link.redirectUrl
              }
            } catch (linkErr: any) {
              console.warn(`[IntegrationExecute] Could not generate direct OAuth link for ${targetSlug}:`, linkErr?.message)
            }
          }

          return {
            success: false,
            authRequired: true,
            provider: targetSlug,
            providerName: providerDisplayName,
            icon: providerIcon,
            category: providerCategory,
            authUrl,
            instruction,
            message: `Authentication required for ${providerDisplayName}. Please connect your account to proceed.`
          }
        }

        // 3. Native Google Integration execution
        if (resolvedDefinition?.type === 'native') {
          const actionExec = await executeIntegratedAction(userId, targetSlug, `${targetSlug}_action`, { instruction })
          return {
            success: actionExec.success,
            authRequired: actionExec.authRequired || false,
            authUrl: actionExec.authUrl,
            provider: targetSlug,
            providerName: providerDisplayName,
            icon: providerIcon,
            category: providerCategory,
            instruction,
            output: actionExec.output,
            message: actionExec.message || `Action executed successfully on ${providerDisplayName}`
          }
        }

        // 4. Composio Integration dynamic execution
        const apiKey = process.env.COMPOSIO_API_KEY
        if (!apiKey) {
          return {
            success: false,
            authRequired: false,
            provider: targetSlug,
            providerName: providerDisplayName,
            icon: providerIcon,
            instruction,
            error: 'COMPOSIO_API_KEY not configured on server.'
          }
        }

        const { Composio } = await import('@composio/core')
        const { VercelProvider } = await import('@composio/vercel')
        const client = new Composio({ apiKey, provider: new VercelProvider() })

        let providerTools: Record<string, any> = {}
        try {
          providerTools = await client.tools.get(userId, { toolkits: [targetSlug] })
        } catch (toolsErr: any) {
          const errMsg = toolsErr?.message || String(toolsErr)
          if (errMsg.includes('No active connection') || errMsg.includes('auth') || errMsg.includes('401')) {
            const link = await createComposioConnectionLink(userId, targetSlug).catch(() => ({ redirectUrl: `/integrations/${targetSlug}` }))
            return {
              success: false,
              authRequired: true,
              provider: targetSlug,
              providerName: providerDisplayName,
              icon: providerIcon,
              category: providerCategory,
              authUrl: link.redirectUrl,
              instruction,
              message: `Your session for ${providerDisplayName} needs authorization. Please connect your account.`
            }
          }
          throw toolsErr
        }

        // Run sub-agent with dynamically discovered tools
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
        const { generateText } = await import('ai')

        const google = createGoogleGenerativeAI({
          apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''
        })
        const model = google('gemini-2.5-flash', { structuredOutputs: false })

        const subAgentResult = await generateText({
          model,
          tools: providerTools as Record<string, any>,
          maxSteps: 5,
          prompt: `You are an integration executor acting on behalf of user ${userId}. You have access to ${providerDisplayName} tools.
Please accomplish the following task:
${instruction}

Execute the necessary tool calls. If you need more information or specific identifiers (like repos, channels, or issue types), query or list them first. Summarize the outcome clearly.`
        })

        return {
          success: true,
          authRequired: false,
          provider: targetSlug,
          providerName: providerDisplayName,
          icon: providerIcon,
          category: providerCategory,
          instruction,
          toolCallsCount: subAgentResult.steps?.flatMap(s => s.toolCalls || []).length || 1,
          output: subAgentResult.text,
          message: subAgentResult.text
        }
      } catch (err: any) {
        return {
          success: false,
          authRequired: false,
          provider,
          instruction,
          error: err?.message || 'Tool execution failed'
        }
      }
    }
  })
}

