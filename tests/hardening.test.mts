import { conditionFromWmoCode } from '../server/utils/tools/weather'
import { parseSearchResults } from '../server/utils/tools/webSearch'
import { pickGuestReply } from '../src/utils/guestReply'
import { clientAddress, enforceRateLimit, resetRateLimits } from '../server/utils/rateLimit'
import { MAX_CONTEXT_MESSAGES, assertMessageSizes, assertNewChatMessage, trimHistory } from '../server/utils/limits'

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
assert(throws(() => assertNewChatMessage('hi', Array.from({ length: 6 }, () => ({ url: 'u' })))) !== null, 'too many attachments rejected')
const status = (e: any) => e?.status ?? e?.statusCode
assert(status(throws(() => assertNewChatMessage('hi', [{ url: 'x'.repeat(900_000), contentType: 'image/jpeg', name: 'a.jpg' }]))) === 413, 'a new chat message near the document limit is rejected before anything is written')
assert(throws(() => assertNewChatMessage('hi', [{ url: 'x'.repeat(100_000) }])) === null, 'a reasonable attachment is accepted')
// Multibyte text: 400k characters are about 1.2 MB in UTF-8, over the document limit.
assert(status(throws(() => assertMessageSizes([{ parts: [{ type: 'text', text: '日'.repeat(400_000) }] }]))) === 413, 'size is measured in bytes, not characters')

const long = Array.from({ length: 450 }, (_, i) => ({ id: String(i), role: i % 2 === 0 ? 'user' : 'assistant' }))
const trimmed = trimHistory(long)
assert(trimmed.length <= MAX_CONTEXT_MESSAGES && trimmed[0]?.role === 'user' && trimmed.at(-1)?.id === '449', 'long chats keep working: history is trimmed to recent messages starting at a user turn')
assert(trimHistory(long.slice(0, 10)).length === 10, 'short chats are untouched')

// A full limiter must not evict live buckets (that would reset an active caller's count).
resetRateLimits()
enforceRateLimit(fakeEvent, 'cap', 'victim', 2, 60_000)
enforceRateLimit(fakeEvent, 'cap', 'victim', 2, 60_000)
for (let i = 0; i < 10_050; i++) { try { enforceRateLimit(fakeEvent, 'flood', `s${i}`, 5, 60_000) } catch { /* overflow bucket may trip */ } }
assert(status(throws(() => enforceRateLimit(fakeEvent, 'cap', 'victim', 2, 60_000))) === 429, 'flooding with new keys does not reset an active bucket')

const withHeaders = (xff: string | null, hops?: string): any => {
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = hops
  return { req: { headers: new Headers(xff ? { 'x-forwarded-for': xff } : {}) }, runtime: undefined, node: undefined }
}
assert(clientAddress(withHeaders('6.6.6.6, 203.0.113.9')) === '203.0.113.9', 'spoofed left-hand X-Forwarded-For values are ignored (default one trusted hop)')
assert(clientAddress(withHeaders('6.6.6.6, 198.51.100.4, 203.0.113.9', '2')) === '198.51.100.4', 'TRUSTED_PROXY_HOPS picks the address from the right')
delete process.env.TRUSTED_PROXY_HOPS

// Signed-out visitors get a relevant, model-free invitation to sign in.
assert(/Automations/.test(pickGuestReply('Create a workflow that emails me every Monday').opening), 'automation requests get the automation pitch')
assert(/inbox|calendar/i.test(pickGuestReply('draft a reply to my latest gmail').opening), 'email requests get the inbox pitch')
assert(/Research/.test(pickGuestReply('find the latest news about gemini').opening), 'research requests get the research pitch')
assert(pickGuestReply('hello').highlights.length === 3, 'anything else gets the general introduction')
