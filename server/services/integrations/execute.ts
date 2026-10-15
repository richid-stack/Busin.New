import { generateText, isStepCount } from 'ai'
import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'
import { getComposioApiKey, getActiveComposioConnection, createComposioConnectionLink } from '../composio/client'
import { composioToolkitSlug } from './slugs'
import { getLanguageModel, pickAvailableModel } from '../../utils/models'

export interface IntegrationRunResult {
  success: boolean
  authRequired?: boolean
  authUrl?: string
  output: any
  message: string
  toolCalls: number
}

let agentClient: Composio<VercelProvider> | null = null
function getAgentClient(): Composio<VercelProvider> | null {
  const apiKey = getComposioApiKey()
  if (!apiKey) return null
  agentClient ??= new Composio({ apiKey, provider: new VercelProvider() })
  return agentClient
}

function toolOutcome(result: any): { ok: boolean, error?: string } {
  const out = result?.output ?? result?.result
  if (out && typeof out === 'object') {
    if (out.successful === false) return { ok: false, error: String(out.error || 'tool reported failure') }
    if (out.error && out.successful !== true) return { ok: false, error: String(out.error) }
  }
  return { ok: true }
}

/**
 * Runs a natural-language instruction against one of the user's connected apps.
 * Every provider (Google Workspace and third-party) goes through the same path, and the result is
 * only reported as a success when at least one tool call really ran and none of them failed.
 */
export async function runIntegrationInstruction(opts: {
  userId: string
  provider: string
  providerName: string
  instruction: string
}): Promise<IntegrationRunResult> {
  const { userId, provider, providerName, instruction } = opts
  const client = getAgentClient()
  if (!client) {
    return { success: false, output: null, toolCalls: 0, message: `${providerName} is unavailable: COMPOSIO_API_KEY is not configured on the server.` }
  }

  const connection = await getActiveComposioConnection(userId, provider)
  if (!connection) {
    let authUrl = `/integrations/${provider}`
    try {
      authUrl = (await createComposioConnectionLink(userId, provider)).redirectUrl
    } catch { /* fall back to the in-app connect page */ }
    return { success: false, authRequired: true, authUrl, output: null, toolCalls: 0, message: `Connect your ${providerName} account to continue.` }
  }

  const modelId = pickAvailableModel()
  if (!modelId) {
    return { success: false, output: null, toolCalls: 0, message: 'No AI provider is configured on the server, so the action could not be planned.' }
  }

  const tools = await client.tools.get(userId, { toolkits: [composioToolkitSlug(provider)] }) as Record<string, any>
  if (!tools || Object.keys(tools).length === 0) {
    return { success: false, output: null, toolCalls: 0, message: `No ${providerName} actions are available for this account.` }
  }

  const result = await generateText({
    model: getLanguageModel(modelId),
    tools,
    stopWhen: isStepCount(6),
    abortSignal: AbortSignal.timeout(90_000),
    instructions: `You carry out one task on behalf of the user in ${providerName}, using only the provided tools. If you need identifiers (channels, folders, repos, ids), look them up with the tools first. Never invent results. If the task cannot be done, say exactly why. Finish with a one or two sentence summary of what actually happened.`,
    prompt: instruction
  })

  const calls = result.steps.flatMap(s => s.toolCalls ?? [])
  const results = result.steps.flatMap(s => s.toolResults ?? [])
  const failures = results.map(toolOutcome).filter(r => !r.ok)

  if (calls.length === 0) {
    return { success: false, output: result.text || null, toolCalls: 0, message: result.text?.trim() || `No ${providerName} action was performed.` }
  }
  if (failures.length > 0 && failures.length >= results.length) {
    return { success: false, output: result.text || null, toolCalls: calls.length, message: `${providerName} action failed: ${failures[0]?.error}` }
  }
  return {
    success: true,
    output: { summary: result.text, toolCalls: calls.length, failedCalls: failures.length },
    toolCalls: calls.length,
    message: result.text?.trim() || `Completed on ${providerName}.`
  }
}
