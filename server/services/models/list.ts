import { safeFetch, UnsafeUrlError } from '../../utils/netSafety'
import type { ListedModel, ModelProviderDef } from '../../../shared/modelProviders'

export class ModelListError extends Error {
  constructor(message: string, readonly status = 502) { super(message) }
}

/** One GET that returns parsed JSON. Swapped in tests; the real one only talks to public addresses. */
export type JsonGetter = (url: string, headers: Record<string, string>) => Promise<{ status: number, json: unknown }>

export const publicJsonGetter: JsonGetter = async (url, headers) => {
  try {
    const res = await safeFetch(url, { headers: { accept: 'application/json', ...headers }, timeoutMs: 15_000, maxBytes: 8_000_000, redirect: 'manual' })
    let json: unknown = null
    try { json = JSON.parse(res.body.toString('utf8')) } catch { /* reported by the caller */ }
    return { status: res.status, json }
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ModelListError(err.message, 400)
    throw new ModelListError('Could not reach that service. Check the address and try again.')
  }
}

const MAX_MODELS = 600
const NOT_CHAT = /(embed|rerank|whisper|tts|text-to-speech|speech|transcri|moderation|dall-e|imagen|image-gen|gpt-image|sora|veo|davinci|babbage|realtime|audio|aqa|guard-|-ocr$|computer-use)/i

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : '')

/** Pulls the array of models out of whichever shape a service uses: {data:[…]}, {models:[…]} or a bare array. */
export function modelArray(json: unknown): any[] {
  if (Array.isArray(json)) return json
  const obj = json as any
  if (Array.isArray(obj?.data)) return obj.data
  if (Array.isArray(obj?.models)) return obj.models
  return []
}

/** Reads one entry of an OpenAI-style list, keeping what the service says about it. Null when it is not a chat model. */
export function readCompatible(item: any): ListedModel | null {
  const id = text(item?.id ?? item?.name, 200)
  if (!id || NOT_CHAT.test(id)) return null
  // Services that say what kind of model it is are believed over the name.
  const type = text(item?.type ?? item?.object_type, 30).toLowerCase()
  if (type && !['chat', 'language', 'model', 'text', 'llm'].includes(type)) return null
  if (item?.capabilities && item.capabilities.completion_chat === false) return null
  const out = item?.architecture?.output_modalities
  if (Array.isArray(out) && !out.includes('text')) return null
  const params: unknown[] = Array.isArray(item?.supported_parameters) ? item.supported_parameters : []
  const modalities: unknown[] = Array.isArray(item?.architecture?.input_modalities) ? item.architecture.input_modalities : []
  const price = item?.pricing
  return {
    id,
    label: text(item?.display_name ?? item?.name ?? id) || id,
    context: num(item?.context_length ?? item?.context_window ?? item?.max_context_length ?? item?.top_provider?.context_length),
    created: num(item?.created),
    ...(params.includes('tools') || item?.capabilities?.function_calling === true ? { tools: true } : {}),
    ...(modalities.includes('image') || item?.supports_image_in === true || item?.capabilities?.vision === true ? { vision: true } : {}),
    ...(params.includes('reasoning') || item?.supports_reasoning === true ? { reasoning: true } : {}),
    ...(price && String(price.prompt) === '0' && String(price.completion) === '0' ? { free: true } : {})
  }
}

function tidy(models: ListedModel[]): ListedModel[] {
  const seen = new Set<string>()
  const unique = models.filter(m => !seen.has(m.id) && seen.add(m.id))
  // Newest first when the service says when a model was made, otherwise by name.
  return unique.sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.label.localeCompare(b.label)).slice(0, MAX_MODELS)
}

function failFor(status: number, name: string): ModelListError {
  if (status === 401 || status === 403) return new ModelListError(`${name} did not accept that key. Check it was copied whole and is still active.`, 400)
  if (status === 404) return new ModelListError(`${name} has no model list at that address. Check the address, or add a model by name.`, 400)
  if (status === 429) return new ModelListError(`${name} says too many requests right now. Wait a minute and try again.`, 429)
  return new ModelListError(`${name} could not give its model list (error ${status}). Try again in a moment.`)
}

/** Asks a provider for the models it really offers right now, with the person's own key. */
export async function fetchProviderModels(def: ModelProviderDef, opts: { apiKey: string, baseUrl?: string, get?: JsonGetter }): Promise<ListedModel[]> {
  const get = opts.get ?? publicJsonGetter
  const base = (opts.baseUrl || def.baseUrl).replace(/\/+$/, '')
  if (!base) throw new ModelListError('Add the service’s address first.', 400)

  if (def.fixedModels) return def.fixedModels.map(m => ({ id: m.id, label: m.label }))

  if (def.kind === 'anthropic') {
    const all: ListedModel[] = []
    let after = ''
    for (let page = 0; page < 5; page++) {
      const res = await get(`${base}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`, { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' })
      if (res.status !== 200) throw failFor(res.status, def.name)
      const body = res.json as any
      for (const m of modelArray(body)) {
        const id = text(m?.id, 200)
        if (id) all.push({ id, label: text(m?.display_name) || id, created: m?.created_at ? Math.floor(Date.parse(m.created_at) / 1000) || undefined : undefined, tools: true, vision: true })
      }
      if (!body?.has_more || !body?.last_id) break
      after = String(body.last_id)
    }
    return tidy(all)
  }

  if (def.kind === 'google') {
    const all: ListedModel[] = []
    let token = ''
    for (let page = 0; page < 5; page++) {
      const res = await get(`${base}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { 'x-goog-api-key': opts.apiKey })
      if (res.status !== 200) throw failFor(res.status, def.name)
      const body = res.json as any
      for (const m of modelArray(body)) {
        const id = text(m?.name, 200).replace(/^models\//, '')
        const methods: unknown[] = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : []
        if (!id || !methods.includes('generateContent') || /(embed|aqa|imagen|veo|tts|native-audio|image)/i.test(id)) continue
        all.push({ id, label: text(m?.displayName) || id, context: num(m?.inputTokenLimit), tools: true, vision: true, reasoning: m?.thinking === true ? true : undefined })
      }
      token = typeof body?.nextPageToken === 'string' ? body.nextPageToken : ''
      if (!token) break
    }
    return tidy(all)
  }

  // OpenAI and everything that speaks like it.
  const res = await get(`${base}/models`, opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {})
  if (res.status !== 200) throw failFor(res.status, def.name)
  const list = modelArray(res.json)
  if (!list.length) throw new ModelListError(`${def.name} answered, but with no models. Check the address, or add a model by name.`, 400)
  return tidy(list.map(readCompatible).filter((m): m is ListedModel => m !== null))
}
