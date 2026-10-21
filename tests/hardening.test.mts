import { conditionFromWmoCode } from '../server/utils/tools/weather'
import { parseSearchResults } from '../server/utils/tools/webSearch'
import { enforceRateLimit, resetRateLimits } from '../server/utils/rateLimit'
import { assertAttachments, assertMessageSizes } from '../server/utils/limits'

const assert = (c: unknown, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const throws = (fn: () => void) => { try { fn(); return null } catch (e: any) { return e } }

assert(conditionFromWmoCode(0).text === 'Sunny' && conditionFromWmoCode(61).text === 'Rainy' && conditionFromWmoCode(73).text === 'Snowy' && conditionFromWmoCode(95).text === 'Thunderstorms', 'WMO codes map to conditions')

const html = `<h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">Example &amp; A</a></h2>
<a class="result__snippet" href="x">A <b>snippet</b> here</a>`
const parsed = parseSearchResults(html)
assert(parsed.sources[0]?.url === 'https://example.com/a' && parsed.sources[0]?.title === 'Example & A', 'search parser decodes redirect urls and titles')
assert(parsed.snippets[0] === 'A snippet here', 'search parser extracts snippets')
assert(parseSearchResults('<html></html>').sources.length === 0, 'empty page yields no sources')

const headers = new Map<string, string>()
const fakeEvent: any = { res: { headers: { set: (k: string, v: string) => headers.set(k, v) } } }
resetRateLimits()
for (let i = 0; i < 3; i++) enforceRateLimit(fakeEvent, 't', 'a', 3, 60_000)
const err = throws(() => enforceRateLimit(fakeEvent, 't', 'a', 3, 60_000))
assert(err?.status === 429 || err?.statusCode === 429, 'rate limit rejects with 429 past the limit')
assert(headers.has('Retry-After'), 'rate limit sets Retry-After')
assert(throws(() => enforceRateLimit(fakeEvent, 't', 'b', 3, 60_000)) === null, 'other subjects are independent')

assert(throws(() => assertMessageSizes([{ id: '1', parts: [{ type: 'text', text: 'hi' }] }])) === null, 'small message accepted')
assert((throws(() => assertMessageSizes([{ parts: [{ url: 'x'.repeat(1_000_000) }] }])) as any)?.status === 413 || (throws(() => assertMessageSizes([{ parts: [{ url: 'x'.repeat(1_000_000) }] }])) as any)?.statusCode === 413, 'oversized message rejected with 413')
assert(throws(() => assertAttachments(Array.from({ length: 6 }, () => ({ url: 'u' })))) !== null, 'too many attachments rejected')
