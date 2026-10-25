import type { LanguageModel } from 'ai'
import { HTTPError } from 'nitro'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { parseMyModelId, providerById } from '../../../shared/modelProviders'
import type { ModelProviderDef } from '../../../shared/modelProviders'
import { getLanguageModel } from '../../utils/models'
import { UnsafeUrlError, parseSafeUrl } from '../../utils/netSafety'
import { open } from '../../utils/secretBox'
import { createStreamingFetch } from '../mcp/streamFetch'
import { getConnection } from './store'
import type { ModelConnection } from './store'

export const KEY_PURPOSE = 'model-key'

/** An address a person typed must be https and public. Fixed provider addresses are never typed, so they skip this. */
export function checkBaseUrl(raw: string): string {
  let url: URL
  try {
    url = parseSafeUrl(raw)
  } catch (err) {
    throw new HTTPError({ statusCode: 400, statusMessage: err instanceof UnsafeUrlError ? err.message : 'That is not a valid address.' })
  }
  if (url.protocol !== 'https:') throw new HTTPError({ statusCode: 400, statusMessage: 'The address must start with https://' })
  if (url.search || url.hash) throw new HTTPError({ statusCode: 400, statusMessage: 'Leave out anything after "?" or "#" in the address.' })
  return url.href.replace(/\/+$/, '')
}

/** Builds the AI SDK model for one of the person's own models. Pure given a connection and its key. */
export function buildMyModel(def: ModelProviderDef, connection: Pick<ModelConnection, 'baseUrl'>, apiKey: string, model: string): LanguageModel {
  const baseURL = connection.baseUrl || def.baseUrl
  switch (def.kind) {
    case 'openai': return createOpenAI({ apiKey, ...(connection.baseUrl ? { baseURL } : {}) })(model)
    case 'anthropic': return createAnthropic({ apiKey })(model)
    case 'google': return createGoogleGenerativeAI({ apiKey })(model)
    case 'compatible': {
      // The provider is named my-<id> so the chat's own provider settings (made for the built-in models) never reach it.
      // An address the person chose is always connected to through the public-address guard.
      const typed = Boolean(connection.baseUrl) || def.custom
      return createOpenAICompatible({
        name: `my-${def.id}`,
        baseURL,
        apiKey,
        includeUsage: true,
        ...(typed ? { fetch: createStreamingFetch({ validateUrl: (raw: string) => { const url = parseSafeUrl(raw); if (url.protocol !== 'https:') throw new UnsafeUrlError('Use an https address.'); return url } }) } : {})
      }).chatModel(model)
    }
  }
}

export interface ResolvedModel { model: LanguageModel, /** Runs on the person's own key, so it costs them no credits here. */ own: boolean }

/**
 * The model for a request. A built-in model comes from the app's keys; `my:` models use the key the person
 * saved, and only if they have switched that model on.
 */
export async function resolveModel(userId: string | null, modelId: string, deps: { getConnection?: typeof getConnection } = {}): Promise<ResolvedModel> {
  const mine = parseMyModelId(modelId)
  if (!mine) return { model: getLanguageModel(modelId), own: false }
  if (!userId) throw new HTTPError({ statusCode: 401, statusMessage: 'Sign in to use your own models.' })
  const def = providerById(mine.providerId)
  const connection = def ? await (deps.getConnection ?? getConnection)(userId, mine.providerId) : null
  if (!def || !connection) throw new HTTPError({ statusCode: 400, statusMessage: 'That model’s provider is not connected. Connect it under Models.' })
  if (!connection.enabled.includes(mine.model) && !connection.manual.includes(mine.model)) {
    throw new HTTPError({ statusCode: 400, statusMessage: 'That model is switched off. Switch it on under Models.' })
  }
  let apiKey: string
  try {
    apiKey = open(connection.sealedKey, KEY_PURPOSE)
  } catch {
    throw new HTTPError({ statusCode: 400, statusMessage: `The saved ${def.name} key cannot be read. Connect it again under Models.` })
  }
  return { model: buildMyModel(def, connection, apiKey, mine.model), own: true }
}
