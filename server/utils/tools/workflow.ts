import { tool } from 'ai'
import { z } from 'zod'
import { createWorkflow, ensureDefaultWorkflow, getWorkflow, resolveWorkflowId } from '../firebase'
import { DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../workflowEngine'
import { executeAndRecordRun } from '../workflowRuns'
import { getResolvedUserIntegrations, ALL_INTEGRATIONS_CATALOG, executeIntegratedAction } from '../../services/integrations/registry'

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
        studioUrl: `/workflows/${workflow.id}`,
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
  description: `Trigger a test run or active execution of an existing workflow. Executes all nodes using the AI engine and provides real outputs and logs.`,
  inputSchema: z.object({
    workflowId: z.string().default('client-onboarding-pipeline').describe('ID of the workflow to run'),
    inputSummary: z.string().optional().describe('Text describing the test trigger event (made available to the workflow as the trigger payload)')
  }),
  execute: async ({ workflowId, inputSummary }) => {
    try {
      const id = resolveWorkflowId(userId, workflowId)
      const workflow = id !== workflowId
        ? await ensureDefaultWorkflow(userId, { nodes: DEFAULT_WORKFLOW_NODES, edges: DEFAULT_WORKFLOW_EDGES })
        : await getWorkflow(id)
      // Unknown ids and other users' workflows look identical, and nothing is recorded for them.
      if (!workflow || workflow.userId !== userId) {
        return { success: false, error: `Workflow "${workflowId}" was not found` }
      }

      const inputPayload = inputSummary
        ? { source: 'chat_test_run', text: inputSummary }
        : undefined

      const { run, result } = await executeAndRecordRun(workflow, inputPayload, userId)

      const failed = result.logs.filter(l => l.status === 'failed' || l.status === 'auth_required')
      return {
        success: result.status === 'completed' || result.status === 'waiting_approval',
        runId: run.id,
        workflowId: workflow.id,
        title: workflow.title,
        status: result.status,
        approvalPrompt: result.approvalPrompt,
        approvalData: result.approvalData,
        durationMs: result.durationMs,
        steps: result.logs.map(l => ({ nodeId: l.nodeId, title: l.nodeTitle, status: l.status, message: l.message, authUrl: l.authUrl })),
        outputs: result.outputs,
        summary: result.status === 'completed'
          ? `Workflow "${workflow.title}" completed in ${result.durationMs}ms across ${result.logs.length} steps.`
          : result.status === 'waiting_approval'
            ? `Workflow "${workflow.title}" is paused and waiting for approval.`
            : `Workflow "${workflow.title}" ${result.status}: ${failed.map(f => `${f.nodeTitle} (${f.message})`).join('; ') || 'see step logs'}.`
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
  description: `Check which external services (Google Workspace, Slack, Notion, GitHub, Linear, Jira and others) the user has connected, and what each can do.`,
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const integrations = await getResolvedUserIntegrations(userId)
      const services = integrations.map(i => ({
        provider: i.provider,
        name: i.name,
        category: i.category,
        status: i.status,
        account: i.account,
        // In-app page where the user can connect this service.
        connectPath: `/integrations/${i.provider}`,
        capabilities: i.capabilities
      }))
      return {
        connectedServices: services,
        readyForAutomation: services.some(i => i.status === 'connected'),
        // Apps connected by authorizing (Google, Slack...) need the integration provider key; services that take a pasted key (Paystack, Arkesel) do not.
        integrationsAvailable: integrations.some(i => i.canConnect && i.type !== 'custom'),
        keyConnectorsAvailable: integrations.some(i => i.type === 'custom')
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

const PROVIDER_ALIASES: Record<string, string> = {
  gh: 'github',
  mail: 'gmail',
  email: 'gmail',
  drive: 'google_drive',
  sheets: 'google_sheets',
  docs: 'google_docs',
  calendar: 'google_calendar',
  tasks: 'google_tasks',
  teams: 'microsoft_teams',
  onedrive: 'one_drive'
}

export function resolveIntegrationDefinition(providerSlug: string) {
  const norm = providerSlug.toLowerCase().trim().replace(/[- ]/g, '_')
  const slug = PROVIDER_ALIASES[norm] ?? norm
  return ALL_INTEGRATIONS_CATALOG.find(i => i.provider === slug || i.name.toLowerCase().replace(/ /g, '_') === slug) ?? null
}

export function createIntegrationExecuteTool(userId: string) {
  return tool({
    description: `Carry out a task in one of the user's connected apps (e.g. GitHub, Slack, Gmail, Notion, Linear, Google Drive, Jira).
Use this when the user asks to create, read, send or update something in an external app.
Provide the provider slug (e.g. 'github', 'slack', 'gmail') and a clear natural language instruction.`,
    inputSchema: z.object({
      provider: z.string().describe('The service provider slug, e.g. "github", "slack", "gmail", "linear", "notion"'),
      instruction: z.string().describe('What to do, in detail (e.g. "Create a high priority issue titled User Login Bug with description...")')
    }),
    execute: async ({ provider, instruction }, { abortSignal }) => {
      // Catalogued apps use their definition; any other slug is tried as a Composio toolkit.
      const norm = provider.toLowerCase().trim().replace(/[- ]/g, '_')
      const definition = resolveIntegrationDefinition(provider)
        ?? (/^[a-z0-9][a-z0-9_-]{1,39}$/.test(norm)
          ? { provider: norm, name: norm.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: 'i-lucide-plug', category: 'Other' }
          : null)
      if (!definition) {
        return { success: false, provider, instruction, error: `Unknown integration "${provider}". Use the integration status tool to see what is available.` }
      }

      const result = await executeIntegratedAction(userId, definition.provider, `${definition.provider}_action`, { instruction }, { abortSignal })
      return {
        success: result.success,
        authRequired: result.authRequired ?? false,
        authUrl: result.authUrl,
        provider: definition.provider,
        providerName: definition.name,
        icon: definition.icon,
        category: definition.category,
        instruction,
        output: result.output,
        message: result.message,
        ...(result.success ? {} : { error: result.message })
      }
    }
  })
}
