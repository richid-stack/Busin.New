import { PROVIDERS, providerOrder, resetSearchCooldowns, searchWeb } from '../server/services/web/search'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

type Call = { url: string, init: any }
function fakeFetch(handlers: Record<string, () => Response>, calls: Call[]) {
  return (async (input: any, init: any) => {
    const url = String(input)
    calls.push({ url, init })
    const key = Object.keys(handlers).find(k => url.startsWith(k))
    if (!key) throw new Error(`unexpected request to ${url}`)
    return handlers[key]!()
  }) as typeof fetch
}

const parallelOk = () => json({ results: [{ url: 'https://a.example/1', title: 'A', excerpts: ['alpha', 'beta'] }] })
const tavilyOk = () => json({ results: [{ url: 'https://b.example/1', title: 'B', content: 'bravo' }] })
const firecrawlOk = () => json({ success: true, data: { web: [{ url: 'https://c.example/1', title: 'C', description: 'charlie' }] } })
const ddgHtml = () => new Response('<a class="result__a" href="https://d.example/1">D</a><a class="result__snippet">delta</a>', { status: 200 })

assert(providerOrder({}).join() === 'parallel,tavily,firecrawl,duckduckgo', 'default order is free-tier first')
assert(providerOrder({ SEARCH_PROVIDERS: 'tavily, bogus ,duckduckgo' }).join() === 'tavily,duckduckgo', 'SEARCH_PROVIDERS overrides the order and ignores unknown names')

// No keys: only DuckDuckGo is used.
let calls: Call[] = []
let out = await searchWeb('cocoa', undefined, {}, fakeFetch({ 'https://html.duckduckgo.com': ddgHtml }, calls))
assert(out.provider === 'duckduckgo' && out.hits[0]?.snippet === 'delta' && calls.length === 1, 'without keys the free fallback answers')

// Keys present: first provider wins and gets the right request.
calls = []
out = await searchWeb('cocoa', undefined, { PARALLEL_API_KEY: 'p', TAVILY_API_KEY: 't' }, fakeFetch({ 'https://api.parallel.ai': parallelOk, 'https://api.tavily.com': tavilyOk }, calls))
assert(out.provider === 'parallel' && out.hits[0]?.snippet === 'alpha beta', 'Parallel is tried first and its excerpts become snippets')
assert(calls.length === 1 && calls[0]!.init.headers['x-api-key'] === 'p' && JSON.parse(calls[0]!.init.body).search_queries[0] === 'cocoa', 'Parallel request carries the key and query')

// Quota error: fall through to the next provider and rest the exhausted one.
resetSearchCooldowns()
calls = []
const env = { PARALLEL_API_KEY: 'p', TAVILY_API_KEY: 't' }
out = await searchWeb('cocoa', undefined, env, fakeFetch({ 'https://api.parallel.ai': () => json({}, 429), 'https://api.tavily.com': tavilyOk }, calls))
assert(out.provider === 'tavily' && out.attempts[0]?.error?.includes('429'), 'a quota error falls through to the next provider')
calls = []
out = await searchWeb('cocoa again', undefined, env, fakeFetch({ 'https://api.parallel.ai': parallelOk, 'https://api.tavily.com': tavilyOk }, calls))
assert(out.provider === 'tavily' && calls.every(c => !c.url.includes('parallel')), 'an exhausted provider is not retried straight away')

// Everything fails: reported, not invented.
resetSearchCooldowns()
out = await searchWeb('x', undefined, { TAVILY_API_KEY: 't' }, fakeFetch({ 'https://api.tavily.com': () => json({}, 500), 'https://html.duckduckgo.com': () => new Response('', { status: 503 }) }, []))
assert(out.hits.length === 0 && out.attempts.length === 2 && out.attempts.every(a => a.error), 'when every provider fails the outcome says so')

// Empty results from one provider move on to the next.
resetSearchCooldowns()
out = await searchWeb('x', undefined, { TAVILY_API_KEY: 't', FIRECRAWL_API_KEY: 'f' }, fakeFetch({ 'https://api.tavily.com': () => json({ results: [] }), 'https://api.firecrawl.dev': firecrawlOk }, []))
assert(out.provider === 'firecrawl' && out.hits[0]?.snippet === 'charlie', 'no results from one provider moves on to the next')
assert(Object.keys(PROVIDERS).length === 4, 'four providers are registered')
resetSearchCooldowns()
