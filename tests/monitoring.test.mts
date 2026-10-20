import { formatBrowserError, formatServerError, isExpectedError, reportServerError, safePath, scrubSecrets } from '../server/services/monitoring/report'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

// ---- Secrets never reach the logs ----
const samples = [
  'Authorization: Bearer abcdef1234567890abcdef',
  'failed with token=SuperSecretValue123',
  'api_key: "AIzaSyD-abcdefghijklmnopqrstu"',
  'key sk-live1234567890abcdefgh used',
  'ghp_abcdefghijklmnop1234567 leaked',
  'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
  'password=hunter2hunter2'
]
for (const s of samples) {
  const out = scrubSecrets(s)
  assert(!/abcdef1234567890|SuperSecretValue|AIzaSyD|live1234567890|ghp_abc|eyJhbGci|hunter2/.test(out), `scrubbed: ${s.slice(0, 28)}…`)
}
assert(scrubSecrets('Cannot read properties of undefined (reading "map")') === 'Cannot read properties of undefined (reading "map")', 'ordinary messages are left alone')
assert(scrubSecrets('token=abc').includes('token=') && scrubSecrets('token=SuperSecretValue123').includes('[removed]'), 'the field name stays, the value goes')

// ---- Paths ----
assert(safePath('/api/webhooks/x?secret=topsecret') === '/api/webhooks/x', 'query strings are dropped')
assert(safePath('https://app.example.com/chat/1?a=b#h') === '/chat/1', 'a full URL is reduced to its path')
assert(safePath(undefined) === '' && safePath('') === '', 'no path is fine')

// ---- Which errors count ----
assert(isExpectedError({ status: 404 }) && isExpectedError({ statusCode: 429 }) && isExpectedError({ status: 401 }), 'client errors are expected')
assert(!isExpectedError({ status: 500 }) && !isExpectedError(new Error('boom')), 'server errors are not')
const lines: string[] = []
assert(reportServerError({ status: 400 }, {}, l => lines.push(l)) === false && lines.length === 0, 'an expected error writes nothing')
assert(reportServerError(new Error('boom'), { method: 'POST', path: '/api/chats/1?x=y' }, l => lines.push(l)) === true && lines.length === 1, 'an unexpected error is written')

// ---- Shape for Cloud Error Reporting ----
const entry = JSON.parse(lines[0]!)
assert(entry.severity === 'ERROR' && entry['@type'].endsWith('ReportedErrorEvent'), 'marked as an error event')
assert(/Error: boom/.test(entry.message) && /at /.test(entry.message), 'the stack is in the message, where Error Reporting looks')
assert(entry.context.httpRequest.url === '/api/chats/1' && entry.context.httpRequest.method === 'POST', 'the request is the method and path only')
assert(entry.serviceContext.service.length > 0, 'the service is named')
const withSecret = formatServerError(new Error('call failed, Authorization: Bearer abcdefghijklmnop123'))
assert(!withSecret.message.includes('abcdefghijklmnop123'), 'secrets in an error message are removed')
assert(formatServerError('plain string').message.includes('plain string'), 'a thrown string still reports')
assert(formatServerError(new Error('x'), {}).context === undefined, 'no request, no request context')
assert(formatServerError(new Error('a'.repeat(50_000))).message.length <= 8000, 'a huge error is cut down')

// ---- Browser reports are warnings, never pages ----
const b = formatBrowserError({ message: 'x is not a function', stack: 'at f (app.js:1:1)\ntoken=abcdefgh1234', page: '/settings?code=123', kind: 'error' }, 'UA')
assert(b.severity === 'WARNING' && b.source === 'browser' && !b['@type'], 'a browser error is a warning and not an error event')
assert(!b.message.includes('abcdefgh1234') && b.context!.httpRequest.url === '/settings', 'its secrets and query string are removed')
assert(formatBrowserError({ message: 'm'.repeat(9000), stack: 's'.repeat(9000) }).message.length <= 8000, 'a huge browser report is cut down')
