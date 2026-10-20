import { jsonSchema, tool } from 'ai'
import { runWithTools, type IntegrationRunResult } from '../integrations/execute'
import { ConnectorError, callConnector, validateParams, scrubCreds } from './runtime'
import { audit, defaultDb, getCredentials, takeDailyAllowance } from './store'
import type { ActionDef, ConnectorDef, ParamDef } from './types'

export interface ConnectorRunResult { success: boolean, authRequired?: boolean, authUrl?: string, output: any, message: string }

export interface ConnectorDeps { db?: any, fetch?: typeof fetch, now?: () => Date }

/** Runs one named action with explicit parameters. Nothing here asks a model to decide anything. */
export async function runConnectorAction(userId: string, def: ConnectorDef, actionId: string, params: unknown, deps: ConnectorDeps = {}): Promise<ConnectorRunResult> {
  const action = def.actions.find(a => a.id === actionId)
  if (!action) return { success: false, output: null, message: `${def.name} has no action called "${actionId}". Available: ${def.actions.map(a => a.id).join(', ')}.` }

  const db = deps.db ?? defaultDb()
  const now = deps.now?.() ?? new Date()
  let creds: Record<string, string> | null
  try {
    creds = await getCredentials(db, userId, def.provider)
  } catch {
    return { success: false, output: null, message: `Could not read your ${def.name} key. Try again in a moment.` }
  }
  if (!creds) {
    return { success: false, authRequired: true, authUrl: `/integrations/${def.provider}`, output: null, message: `Add your ${def.name} key to continue.` }
  }

  let values: Record<string, unknown>
  let taken: Awaited<ReturnType<typeof takeDailyAllowance>> | null = null
  try {
    values = validateParams(action, params)
    taken = await takeDailyAllowance(db, userId, def, action, values, now)
    const output = await callConnector(def, action, values, creds, { fetch: deps.fetch })
    if (action.effect === 'write') await audit(db, userId, def, action, true, taken.units, 'done', now)
    return { success: true, output, message: `${action.name} done on ${def.name}.` }
  } catch (err: any) {
    // The call failed, so the allowance it took is given back.
    await taken?.release()
    const message = err instanceof ConnectorError ? err.message : `${def.name} could not be reached. Try again in a moment.`
    if (action.effect === 'write' && taken) await audit(db, userId, def, action, false, taken.units, scrubCreds(message, creds), now)
    return { success: false, output: null, message, ...(err instanceof ConnectorError && err.kind === 'auth' ? { authRequired: true, authUrl: `/integrations/${def.provider}` } : {}) }
  }
}

function schemaFor(params: ParamDef[]) {
  const properties: Record<string, any> = {}
  for (const p of params) {
    const base = { description: p.description }
    properties[p.name] = p.type === 'number' ? { ...base, type: 'integer', minimum: p.min, maximum: p.max }
      : p.type === 'amount' ? { ...base, type: 'number', exclusiveMinimum: 0, maximum: p.max }
        : p.type === 'enum' ? { ...base, type: 'string', enum: p.values }
          : p.type === 'string_list' ? { ...base, type: 'array', items: { type: 'string' }, maxItems: p.maxItems ?? 20 }
            : { ...base, type: 'string', maxLength: p.maxLength ?? 500 }
  }
  return jsonSchema<Record<string, unknown>>({ type: 'object', properties, required: params.filter(p => p.required).map(p => p.name), additionalProperties: false })
}

/** One AI SDK tool per action. A failure comes back as `successful: false` so the run never reads as done. */
export function connectorTools(userId: string, def: ConnectorDef, deps: ConnectorDeps = {}): Record<string, any> {
  return Object.fromEntries(def.actions.map((a: ActionDef) => [a.id, tool({
    description: `${a.description}${a.dailyLimit ? ` Limited to ${a.dailyLimit} a day.` : ''}${a.effect === 'write' ? ' This changes things or reaches other people, so only do it when the task clearly asks for it.' : ''}`,
    inputSchema: schemaFor(a.params),
    execute: async (input: Record<string, unknown>) => {
      const res = await runConnectorAction(userId, def, a.id, input, deps)
      return res.success ? { successful: true, data: res.output } : { successful: false, error: res.message }
    }
  })]))
}

/** Natural-language path: the model may only pick from this connector's declared actions. */
export async function runConnectorInstruction(userId: string, def: ConnectorDef, instruction: string, deps: ConnectorDeps & { abortSignal?: AbortSignal } = {}): Promise<IntegrationRunResult | (ConnectorRunResult & { toolCalls: number })> {
  const creds = await getCredentials(deps.db ?? defaultDb(), userId, def.provider).catch(() => null)
  if (!creds) {
    return { success: false, authRequired: true, authUrl: `/integrations/${def.provider}`, output: null, toolCalls: 0, message: `Add your ${def.name} key to continue.` }
  }
  return runWithTools({ userId, providerName: def.name, instruction, abortSignal: deps.abortSignal, getTools: async () => connectorTools(userId, def, deps) })
}

/** Tries a new key with a harmless read before it is saved. Returns null when the service has no such check. */
export async function verifyKey(def: ConnectorDef, creds: Record<string, string>, deps: { fetch?: typeof fetch } = {}): Promise<{ ok: boolean, message: string } | null> {
  const action = def.actions.find(a => a.id === def.verifyAction)
  if (!action) return null
  try {
    await callConnector(def, action, validateParams(action, {}), creds, deps)
    return { ok: true, message: `${def.name} accepted the key.` }
  } catch (err: any) {
    return { ok: false, message: err instanceof ConnectorError ? err.message : `Could not check the key with ${def.name}.` }
  }
}
