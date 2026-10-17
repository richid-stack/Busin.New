import { parseSearchResults } from './ddgParse'

export interface SearchHit { title: string, url: string, snippet: string }
export interface SearchAttempt { provider: string, error?: string, count?: number }
export interface SearchOutcome { provider: string | null, hits: SearchHit[], attempts: SearchAttempt[] }

type Env = Record<string, string | undefined>

interface Provider {
  name: string
  /** Providers without a key are skipped, so adding a key is all it takes to switch one on. */
  enabled: (env: Env) => boolean
  run: (query: string, env: Env, signal?: AbortSignal, fetchImpl?: typeof fetch) => Promise<SearchHit[]>
}

const LIMIT = 6
const clip = (text: string, max = 500) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

export class ProviderHttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  if (!res.ok) throw new ProviderHttpError(res.status, `responded with ${res.status}`)
  return await res.json() as any
}

export const PROVIDERS: Record<string, Provider> = {
  parallel: {
    name: 'parallel',
    enabled: env => Boolean(env.PARALLEL_API_KEY?.trim()),
    run: async (query, env, signal, fetchImpl = fetch) => {
      const json = await postJson(fetchImpl, 'https://api.parallel.ai/v1/search', { 'x-api-key': env.PARALLEL_API_KEY!.trim() }, {
        objective: query,
        search_queries: [query],
        mode: 'fast',
        advanced_settings: { max_results: LIMIT, excerpt_settings: { max_chars_per_result: 600 } }
      }, signal)
      return (json.results ?? []).map((r: any) => ({ title: String(r.title || r.url), url: String(r.url), snippet: clip((r.excerpts ?? []).join(' ').replace(/\s+/g, ' ')) }))
    }
  },
  tavily: {
    name: 'tavily',
    enabled: env => Boolean(env.TAVILY_API_KEY?.trim()),
    run: async (query, env, signal, fetchImpl = fetch) => {
      const json = await postJson(fetchImpl, 'https://api.tavily.com/search', { Authorization: `Bearer ${env.TAVILY_API_KEY!.trim()}` }, {
        query, max_results: LIMIT, search_depth: 'basic'
      }, signal)
      return (json.results ?? []).map((r: any) => ({ title: String(r.title || r.url), url: String(r.url), snippet: clip(String(r.content ?? '')) }))
    }
  },
  firecrawl: {
    name: 'firecrawl',
    enabled: env => Boolean(env.FIRECRAWL_API_KEY?.trim()),
    run: async (query, env, signal, fetchImpl = fetch) => {
      const json = await postJson(fetchImpl, 'https://api.firecrawl.dev/v2/search', { Authorization: `Bearer ${env.FIRECRAWL_API_KEY!.trim()}` }, {
        query, limit: LIMIT
      }, signal)
      return (json.data?.web ?? []).map((r: any) => ({ title: String(r.title || r.url), url: String(r.url), snippet: clip(String(r.description ?? '')) }))
    }
  },
  duckduckgo: {
    name: 'duckduckgo',
    enabled: () => true,
    run: async (query, _env, signal, fetchImpl = fetch) => {
      const res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal
      })
      if (!res.ok) throw new ProviderHttpError(res.status, `responded with ${res.status}`)
      const { sources, snippets } = parseSearchResults(await res.text(), LIMIT)
      return sources.map((s, i) => ({ title: s.title, url: s.url, snippet: snippets[i] ?? '' }))
    }
  }
}

/** Free-tier-first order. Override with SEARCH_PROVIDERS=tavily,duckduckgo (comma separated) to change it. */
export const DEFAULT_ORDER = ['parallel', 'tavily', 'firecrawl', 'duckduckgo']

/** Providers that told us they are out of quota are left alone for a while instead of retried every search. */
const cooldowns = new Map<string, number>()
const QUOTA_STATUSES = new Set([402, 429, 432, 433])
const COOLDOWN_MS = 10 * 60_000
export const resetSearchCooldowns = () => cooldowns.clear()

export function providerOrder(env: Env): string[] {
  const configured = (env.SEARCH_PROVIDERS ?? '').split(',').map(p => p.trim().toLowerCase()).filter(p => PROVIDERS[p])
  return configured.length > 0 ? configured : DEFAULT_ORDER
}

/**
 * Searches with the first provider that works. A provider with no key, in cooldown, failing, or
 * returning nothing is passed over, so the app keeps searching as keys are added, removed or run out.
 */
export async function searchWeb(query: string, signal?: AbortSignal, env: Env = process.env, fetchImpl?: typeof fetch): Promise<SearchOutcome> {
  const attempts: SearchAttempt[] = []
  for (const name of providerOrder(env)) {
    const provider = PROVIDERS[name]!
    if (!provider.enabled(env)) continue
    if ((cooldowns.get(name) ?? 0) > Date.now()) {
      attempts.push({ provider: name, error: 'cooling down after a quota error' })
      continue
    }
    try {
      const hits = (await provider.run(query, env, signal, fetchImpl)).filter(h => /^https?:\/\//.test(h.url))
      attempts.push({ provider: name, count: hits.length })
      if (hits.length > 0) return { provider: name, hits, attempts }
    } catch (err: any) {
      if (signal?.aborted) throw err
      if (err instanceof ProviderHttpError && QUOTA_STATUSES.has(err.status)) cooldowns.set(name, Date.now() + COOLDOWN_MS)
      attempts.push({ provider: name, error: err?.message || 'failed' })
    }
  }
  return { provider: null, hits: [], attempts }
}
