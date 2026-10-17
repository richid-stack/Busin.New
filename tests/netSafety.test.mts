import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { isPublicIp, parseSafeUrl, readCapped, safeFetch, UnsafeUrlError } from '../server/utils/netSafety'
import { clampResult, withToolLimits } from '../server/utils/tools/limits'
import { resetRateLimits } from '../server/utils/rateLimit'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const throws = (fn: () => unknown) => { try { fn() } catch (e) { return e } return null }

// Addresses: public ones pass; everything internal fails, including IPv6 tricks.
for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert(isPublicIp(ip), `${ip} is public`)
for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
  '::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', 'not-an-ip']) {
  assert(!isPublicIp(ip), `${ip} is blocked`)
}

// URLs: wrong scheme, credentials, ports, internal names and literals are rejected before any traffic.
for (const url of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'http://user:pw@example.com', 'https://example.com:22',
  'http://localhost/', 'http://app.localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data',
  'http://metadata.google.internal/computeMetadata/v1/', 'http://10.0.0.5/', 'http://2130706433/', 'not a url']) {
  assert(throws(() => parseSafeUrl(url)) instanceof UnsafeUrlError, `rejects ${url}`)
}
assert(throws(() => parseSafeUrl('https://93.184.216.34/page?a=1')) === null, 'accepts a public https address')

// A real local server must be unreachable through safeFetch, including via redirect.
const server = createServer((req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/x' }); res.end() } else res.end('secret')
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
const port = (server.address() as any).port
let blocked: unknown = null
try { await safeFetch(`http://127.0.0.1:${port}/`) } catch (e) { blocked = e }
assert(blocked instanceof UnsafeUrlError, 'safeFetch refuses a local server')
let blockedName: unknown = null
try { await safeFetch(`http://localhost.localdomain:${port}/`, { timeoutMs: 2000 }) } catch (e) { blockedName = e }
assert(blockedName instanceof Error, 'a hostname that resolves inward is refused or unreachable')
server.close()

// Size cap
const capped = await readCapped(Readable.from([Buffer.from('a'.repeat(600)), Buffer.from('b'.repeat(600))]), 1000)
assert(capped.body.length === 1000 && capped.truncated, 'readCapped stops at the byte limit and says so')
const whole = await readCapped(Readable.from([Buffer.from('hello')]), 1000)
assert(whole.body.toString() === 'hello' && !whole.truncated, 'small bodies come back whole')

// Shared tool limits
const clamped = clampResult({ status: 'ok', content: 'x'.repeat(50_000), items: ['y'.repeat(20_000)] }, 5_000)
assert(JSON.stringify(clamped).length <= 5_200 && (clamped as any).truncated === true, 'oversized results are cut to the budget')
assert(clampResult({ a: 1 }, 5_000).a === 1, 'small results are untouched')

resetRateLimits()
const run = withToolLimits({ name: 'demo', userId: 'u1', perMinute: 2, timeoutMs: 200, maxResultChars: 1000 }, async (n: number, signal) => {
  if (n === 99) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
  return { status: 'ok' as const, n }
})
assert((await run(1) as any).status === 'ok', 'first call runs')
const slow = await run(99) as any
assert(slow.status === 'failed' && /timed out/.test(slow.error), 'a hung tool is cut off by the timeout')
const third = await run(3) as any
assert(third.status === 'failed' && /too quickly/.test(third.error), 'calls past the per-minute limit come back as a failed result')
resetRateLimits()
