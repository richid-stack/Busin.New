import type { LanguageModel } from 'ai'
import { HTTPError } from 'nitro'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'

export type ModelProvider = 'google' | 'groq' | 'openai' | 'anthropic'

/** Default model used when nothing else is specified (must exist in shared/utils/models.ts). */
export const DEFAULT_MODEL = 'google/gemini-3.5-flash'

/** One sensible model per provider, used when the preferred provider has no API key. */
const PROVIDER_FALLBACKS: Array<{ provider: ModelProvider, model: string }> = [
  { provider: 'google', model: 'google/gemini-3.5-flash' },
  { provider: 'groq', model: 'groq/gpt-oss-120b' },
  { provider: 'openai', model: 'openai/gpt-5-nano' },
  { provider: 'anthropic', model: 'anthropic/claude-haiku-4.5' }
]

export function getProviderApiKey(provider: ModelProvider): string | undefined {
  switch (provider) {
    case 'google': return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || undefined
    case 'groq': return process.env.GROQ_API_KEY || undefined
    case 'openai': return process.env.OPENAI_API_KEY || undefined
    case 'anthropic': return process.env.ANTHROPIC_API_KEY || undefined
  }
}

export function providerOf(modelId: string): ModelProvider | null {
  const prefix = modelId.split('/')[0]
  return prefix === 'google' || prefix === 'groq' || prefix === 'openai' || prefix === 'anthropic' ? prefix : null
}

/** Maps retired model ids to the current default so old saved chats/workflows keep working. */
export function normalizeModelId(modelId: string): string {
  if (
    modelId === 'google/gemini-2.5-flash'
    || modelId === 'groq/llama-3.3-70b-versatile'
    || modelId.includes('llama')
  ) {
    return DEFAULT_MODEL
  }
  return modelId
}

/**
 * Picks a model that can actually run: the preferred one if its provider has a key,
 * otherwise the first fallback provider that does. Returns null when no provider is configured.
 */
export function pickAvailableModel(preferred?: string | null): string | null {
  if (preferred) {
    const normalized = normalizeModelId(preferred)
    const provider = providerOf(normalized)
    if (provider && getProviderApiKey(provider)) return normalized
  }
  return PROVIDER_FALLBACKS.find(f => getProviderApiKey(f.provider))?.model ?? null
}

/** Every model that can run right now, preferred one first, one per provider. */
export function availableModels(preferred?: string | null): string[] {
  const first = pickAvailableModel(preferred)
  const rest = PROVIDER_FALLBACKS
    .filter(f => getProviderApiKey(f.provider) && f.provider !== (first ? providerOf(first) : null))
    .map(f => f.model)
  return first ? [first, ...rest] : rest
}

function missingKey(envName: string): never {
  throw new HTTPError({
    statusCode: 400,
    statusMessage: `${envName} is not configured. Add it in the environment settings.`
  })
}

/** Resolves a "provider/model" id (as used in shared/utils/models.ts) to an AI SDK model. */
export function getLanguageModel(modelId: string): LanguageModel {
  const normalized = normalizeModelId(modelId)
  const provider = providerOf(normalized)
  if (!provider) {
    throw new HTTPError({ statusCode: 400, statusMessage: `Unsupported model: ${modelId}` })
  }
  const id = normalized.slice(provider.length + 1)
  const apiKey = getProviderApiKey(provider)

  switch (provider) {
    case 'google':
      if (!apiKey) missingKey('GEMINI_API_KEY')
      return createGoogleGenerativeAI({ apiKey })(id)
    case 'groq': {
      if (!apiKey) missingKey('GROQ_API_KEY')
      const groq = createGroq({ apiKey })
      if (id === 'compound-mini') return groq('groq/compound-mini')
      if (id.includes('gpt-oss-120b')) return groq('openai/gpt-oss-120b')
      if (id.includes('gpt-oss-20b')) return groq('openai/gpt-oss-20b')
      if (id.startsWith('qwen')) return groq(`qwen/${id.replace('qwen/', '')}`)
      return groq(id)
    }
    case 'openai':
      if (!apiKey) missingKey('OPENAI_API_KEY')
      return createOpenAI({ apiKey })(id)
    case 'anthropic':
      if (!apiKey) missingKey('ANTHROPIC_API_KEY')
      return createAnthropic({ apiKey })(id)
  }
}
