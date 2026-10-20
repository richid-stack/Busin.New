import type { ActionDef, ConnectorDef, ParamDef } from './types'

export class ConnectorError extends Error {
  constructor(message: string, readonly kind: 'invalid' | 'auth' | 'limit' | 'upstream' | 'network' = 'invalid') { super(message) }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

const range = (d: ParamDef) => d.min !== undefined && d.max !== undefined ? `between ${d.min} and ${d.max}` : d.min !== undefined ? `at least ${d.min}` : `at most ${d.max}`

function clean(def: ParamDef, raw: unknown): unknown {
  const label = def.name
  switch (def.type) {
    case 'string': {
      if (typeof raw !== 'string') throw new ConnectorError(`"${label}" must be text.`)
      const v = raw.trim()
      if (!v) throw new ConnectorError(`"${label}" cannot be empty.`)
      if (CONTROL.test(v)) throw new ConnectorError(`"${label}" has characters that are not allowed.`)
      if (v.length > (def.maxLength ?? 500)) throw new ConnectorError(`"${label}" is too long (at most ${def.maxLength ?? 500} characters).`)
      if (def.pattern && !def.pattern.test(v)) throw new ConnectorError(`"${label}" is not in the expected format.`)
      return v
    }
    case 'number': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
      if (typeof n !== 'number' || !Number.isInteger(n)) throw new ConnectorError(`"${label}" must be a whole number.`)
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) throw new ConnectorError(`"${label}" must be ${range(def)}.`)
      return n
    }
    case 'amount': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new ConnectorError(`"${label}" must be an amount greater than zero.`)
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw new ConnectorError(`"${label}" can have at most 2 decimal places.`)
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) throw new ConnectorError(`"${label}" must be ${range(def)}.`)
      // Sent in the smallest unit (pesewas).
      return Math.round(n * 100)
    }
    case 'enum': {
      if (typeof raw !== 'string' || !def.values?.includes(raw)) throw new ConnectorError(`"${label}" must be one of: ${def.values?.join(', ')}.`)
      return raw
    }
    case 'string_list': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n;]+/) : null
      if (!list) throw new ConnectorError(`"${label}" must be a list.`)
      const items = [...new Set(list.map(x => String(x ?? '').trim().replace(/^\+/, '')).filter(Boolean))]
      if (items.length === 0) throw new ConnectorError(`"${label}" needs at least one item.`)
      if (items.length > (def.maxItems ?? 20)) throw new ConnectorError(`"${label}" can have at most ${def.maxItems ?? 20} items at a time.`)
      for (const item of items) {
        if (item.length > (def.maxLength ?? 100) || (def.pattern && !def.pattern.test(item))) throw new ConnectorError(`"${item.slice(0, 20)}" is not a valid entry for "${label}".`)
      }
      return items
    }
  }
}

/** Checks what was asked for against what the action accepts. Nothing undeclared gets through. */
export function validateParams(action: ActionDef, input: unknown): Record<string, unknown> {
  const given = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const known = new Set(action.params.map(p => p.name))
  const extra = Object.keys(given).filter(k => !known.has(k))
  if (extra.length) throw new ConnectorError(`${action.name} does not accept: ${extra.slice(0, 5).join(', ')}.`)

  const out: Record<string, unknown> = {}
  for (const def of action.params) {
    let raw = given[def.name]
    if (raw === undefined || raw === null || raw === '') {
      if (def.required) throw new ConnectorError(`"${def.name}" is required.`)
      if (def.default === undefined) continue
      raw = def.default
    }
    out[def.name] = clean(def, raw)
  }
  return out
}

/** How much one use counts against a daily limit: a text to 5 numbers is 5. */
export const unitsOf = (values: Record<string, unknown>) => (Array.isArray(values.recipients) ? values.recipients.length : 1)

export interface BuiltRequest { url: string, init: RequestInit }

export function buildRequest(def: ConnectorDef, action: ActionDef, values: Record<string, unknown>, creds: Record<string, string>): BuiltRequest {
  const base = new URL(def.baseUrl)
  if (base.protocol !== 'https:') throw new ConnectorError('Connectors must use https.')

  const path = action.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = values[name]
    if (typeof v !== 'string' && typeof v !== 'number') throw new ConnectorError(`"${name}" is required.`)
    return encodeURIComponent(String(v))
  })
  const url = new URL(path, base)
  // The key is only ever sent to the connector's own host, whatever was asked.
  if (url.origin !== base.origin) throw new ConnectorError('That request does not stay on the service.')

  const headers: Record<string, string> = { Accept: 'application/json' }
  const secret = creds[def.auth.field]
  if (!secret) throw new ConnectorError('The key is missing. Connect the service again.', 'auth')
  if (def.auth.type === 'bearer') headers.Authorization = `Bearer ${secret}`
  else headers[def.auth.header] = secret

  const mapped: Record<string, unknown> = {}
  for (const [name, key] of Object.entries(action.send ?? {})) if (values[name] !== undefined) mapped[key] = values[name]

  if (action.method === 'GET') {
    for (const [k, v] of Object.entries({ ...mapped, ...(action.fixed ?? {}) })) url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v))
    return { url: url.toString(), init: { method: 'GET', headers } }
  }
  headers['Content-Type'] = 'application/json'
  return { url: url.toString(), init: { method: 'POST', headers, body: JSON.stringify({ ...(action.fixed ?? {}), ...mapped }) } }
}

const MAX_BYTES = 300_000

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); break }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Removes the person's own credentials from any text that is about to be shown or logged. */
export const scrubCreds = (text: string, creds: Record<string, string>) =>
  Object.values(creds).filter(v => v.length >= 6).reduce((t, v) => t.split(v).join('[removed]'), text)

/** Keeps a big answer small: trims long lists, then falls back to a text preview. */
export function bound(value: unknown, maxChars = 6000): unknown {
  const size = (v: unknown) => JSON.stringify(v)?.length ?? 0
  if (size(value) <= maxChars) return value
  const trim = (v: any, n: number): any => Array.isArray(v) ? v.slice(0, n).map(x => trim(x, n)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, n)])) : v
  for (const n of [25, 10, 5, 2]) {
    const t = trim(value, n)
    if (size(t) <= maxChars) return { ...(typeof t === 'object' && !Array.isArray(t) ? t : { data: t }), truncated: true }
  }
  return { truncated: true, preview: JSON.stringify(value).slice(0, maxChars) }
}

export interface CallDeps { fetch?: typeof fetch }

/** One call to the service. Throws ConnectorError with a message that is safe to show. */
export async function callConnector(def: ConnectorDef, action: ActionDef, values: Record<string, unknown>, creds: Record<string, string>, deps: CallDeps = {}): Promise<unknown> {
  const { url, init } = buildRequest(def, action, values, creds)
  let res: Response
  try {
    res = await (deps.fetch ?? fetch)(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new ConnectorError(`Could not reach ${def.name}. Try again in a moment.`, 'network')
  }
  const text = await readCapped(res)
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { /* not JSON */ }

  if (res.status >= 300 && res.status < 400) throw new ConnectorError(`${def.name} sent the request somewhere else, so it was stopped.`, 'upstream')
  if (res.status === 401 || res.status === 403) throw new ConnectorError(`${def.name} refused the key. Check it on the ${def.name} page and connect again.`, 'auth')
  if (res.status === 429) throw new ConnectorError(`${def.name} is limiting requests right now. Try again in a minute.`, 'upstream')
  if (!res.ok) {
    const said = scrubCreds(String(body?.message ?? body?.error ?? '').replace(/\s+/g, ' ').slice(0, 200), creds)
    throw new ConnectorError(res.status >= 500 ? `${def.name} had a problem (${res.status}). Try again later.` : `${def.name} said: ${said || `error ${res.status}`}`, 'upstream')
  }
  // Some services answer 200 with a failure inside the body.
  if (body && typeof body === 'object' && (body.status === false || body.success === false)) {
    throw new ConnectorError(`${def.name} said: ${scrubCreds(String(body.message ?? 'the request failed').slice(0, 200), creds)}`, 'upstream')
  }
  const result = action.summarize ? action.summarize(body) : body
  return bound(scrubCreds(JSON.stringify(result ?? null), creds) === JSON.stringify(result ?? null) ? result : JSON.parse(scrubCreds(JSON.stringify(result ?? null), creds)))
}
