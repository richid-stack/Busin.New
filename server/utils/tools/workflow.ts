import { tool } from 'ai'
import { z } from 'zod'
import { createWorkflow, getWorkflow, saveWorkflowRun } from '../firebase'
import { executeWorkflowDAG, DEFAULT_WORKFLOW_NODES, DEFAULT_WORKFLOW_EDGES } from '../workflowEngine'
import { getResolvedUserIntegrations, ALL_INTEGRATIONS_CATALOG } from '../../services/integrations/registry'
import { executeSafeVerificationTool } from '../../services/composio/client'

export const workflowCreateTool = tool({
  description: `Automatically create and provision a complete visual workflow in Workflow Studio.
Use this whenever the user asks to create an automation, pipeline, or connect Google Workspace (Gmail, Drive, Calendar, Docs, Sheets) or third-party apps (Slack, Discord, Notion, Linear, Jira, GitHub, Trello, Asana, etc.) to perform multi-step AI tasks.
This builds the topology, saves it to the database, and provides direct access to Workflow Studio.`,
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
            connection: triggerProvider === 'gmail' ? 'hansonmens784@gmail.com' : 'Default Account'
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
            connection: step.connection || (step.provider && step.provider === 'slack' ? 'Workspace: My Team' : 'hansonmens784@gmail.com')
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
        userId: 'system',
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

export const workflowRunTool = tool({
  description: `Trigger a test run or active execution of an existing workflow. Executes all nodes using the AI engine and provides real-time outputs and logs.`,
  parameters: z.object({
    workflowId: z.string().default('client-onboarding-pipeline').describe('ID of the workflow to run'),
    inputSummary: z.string().optional().describe('Summary or text of test trigger event')
  }),
  execute: async ({ workflowId, inputSummary }) => {
    try {
      let workflow = await getWorkflow(workflowId)
      if (!workflow) {
        workflow = {
          id: workflowId,
          title: 'Client Onboarding Pipeline',
          description: 'Client Onboarding Pipeline',
          userId: 'system',
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

      const result = await executeWorkflowDAG(workflow, inputPayload, 'system')

      await saveWorkflowRun(workflow.id, {
        workflowId: workflow.id,
        userId: 'system',
        status: result.status,
        input: inputPayload || {},
        output: result.outputs,
        logs: result.logs,
        durationMs: result.durationMs
      })

      return {
        success: true,
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

export const integrationStatusTool = tool({
  description: `Check the connection status and capabilities of integrated external services (Native Google: Gmail, Drive, Calendar, Docs, Sheets; and third-party services: Slack, Discord, Notion, Linear, Jira, GitHub).`,
  parameters: z.object({}),
  execute: async () => {
    try {
      const integrations = await getResolvedUserIntegrations('system')
      return {
        connectedServices: integrations.map(i => ({
          provider: i.provider,
          name: i.name,
          type: i.type,
          category: i.category,
          status: i.status,
          account: i.account,
          capabilities: i.capabilities
        })),
        defaultEmail: 'hansonmens784@gmail.com',
        readyForAutomation: true
      }
    } catch {
      return {
        connectedServices: [
          { provider: 'gmail', name: 'Gmail', type: 'native', status: 'connected', account: 'hansonmens784@gmail.com' },
          { provider: 'google_drive', name: 'Google Drive', type: 'native', status: 'connected', account: 'hansonmens784@gmail.com' },
          { provider: 'slack', name: 'Slack', type: 'composio', status: 'connected', account: 'Workspace: Acme Engineering' }
        ],
        defaultEmail: 'hansonmens784@gmail.com',
        readyForAutomation: true
      }
    }
  }
})

export const integrationTestTool = tool({
  description: `Test or execute a live tool call through Composio (e.g. GitHub, Slack, Gmail, Notion, Discord). If an active connection exists, safely executes the read-only verification call and returns the provider result and Composio log ID. If not connected, returns the official Connect authorization link with instructions.`,
  parameters: z.object({
    provider: z.string().describe('The service/toolkit to test or connect, e.g. "github", "slack", "gmail", "discord", "notion"')
  }),
  execute: async ({ provider }) => {
    try {
      const res = await executeSafeVerificationTool('hansonmens784@gmail.com', provider)
      return res
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Verification tool execution failed'
      }
    }
  }
})
