import jexl from 'jexl'
import { UnsafeUrlError, safeFetch } from './netSafety'
import type { SafeFetchOptions, SafeFetchResult } from './netSafety'
import { PageError, readPage } from '../services/web/reader'
import type { PageResult } from '../services/web/reader'
import { interpolateVariables, stripBraces } from './workflowTemplate'
import { checkRateLimit } from './rateLimit'

/** A step that is set up wrongly. Running it again cannot help, so it is never retried. */
export class NodeConfigError extends Error {}

const OUTBOUND_PER_10_MIN = 300

/** Counts one request a workflow sends to the web. A user can send a limited number every 10 minutes. */
export function spendOutbound(userId: string) {
  const gate = checkRateLimit('workflow-outbound', userId, OUTBOUND_PER_10_MIN, 10 * 60_000)
  if (!gate.ok) throw new NodeConfigError(`Workflows have sent the most web requests allowed for now (${OUTBOUND_PER_10_MIN} every 10 minutes). Try again in ${gate.retryAfter} seconds.`)
}

/** Collaborators the new nodes use, replaceable in tests. */
export interface NodeDeps {
  fetcher?: (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResult>
  pageReader?: (url: string, signal?: AbortSignal) => Promise<PageResult>
  sleep?: (ms: number) => Promise<void>
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// ---------------------------------------------------------------------------
// HTTP Request
// ---------------------------------------------------------------------------

export interface HttpConfig {
  method?: string
  url?: string
  headers?: Array<{ key?: string, value?: string }>
  body?: string
  timeoutSec?: number
  /** Default true: an answer other than 2xx fails the step. False returns it so a later step can look at `status`. */
  failOnError?: boolean
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
// Set by the transport itself; letting a workflow override them would only break or smuggle requests.
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'expect', 'accept-encoding', 'proxy-authorization', 'proxy-connection'])
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/
const MAX_RESPONSE_CHARS = 100_000
export const MAX_REQUEST_BODY = 1_000_000

/** Not retried: a 4xx answer means the request itself is wrong (except "too early", "timeout" and "too many requests"). */
export class RetryableHttpError extends Error {}

export async function runHttpNode(config: HttpConfig, inputs: Record<string, any>, signal: AbortSignal | undefined, deps: NodeDeps = {}) {
  const method = String(config.method || 'GET').toUpperCase() as typeof METHODS[number]
  if (!METHODS.includes(method)) throw new NodeConfigError(`The method ${method} is not supported. Use ${METHODS.join(', ')}.`)

  const rawUrl = interpolateVariables(String(config.url || ''), inputs).trim()
  if (!rawUrl) throw new NodeConfigError('The HTTP Request step has no URL.')
  if (/\[[\w.-]+\]/.test(rawUrl) && /\{\{/.test(String(config.url))) {
    throw new NodeConfigError('The URL uses a value that is not available yet. Check the {{...}} placeholders.')
  }

  const headers: Record<string, string> = {}
  for (const { key, value } of (config.headers ?? []).slice(0, 20)) {
    const name = String(key ?? '').trim()
    if (!name) continue
    if (!HEADER_NAME.test(name)) throw new NodeConfigError(`"${name}" is not a valid header name.`)
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) continue
    const val = interpolateVariables(String(value ?? ''), inputs)
    if (/[\r\n\u0000]/.test(val)) throw new NodeConfigError(`The value of header "${name}" contains a line break.`)
    headers[name] = val
  }

  let body: string | undefined
  if (config.body && method !== 'GET' && method !== 'HEAD') {
    body = interpolateVariables(String(config.body), inputs)
    if (Buffer.byteLength(body) > MAX_REQUEST_BODY) throw new NodeConfigError('The request body is larger than 1 MB.')
    if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = /^\s*[[{]/.test(body) ? 'application/json' : 'text/plain; charset=utf-8'
    }
  }

  const fetcher = deps.fetcher ?? safeFetch
  let res: SafeFetchResult
  try {
    res = await fetcher(rawUrl, {
      method,
      headers,
      body,
      signal,
      redirect: 'manual',
      timeoutMs: clampInt(config.timeoutSec, 1, 30, 15) * 1000,
      maxBytes: 1_000_000
    })
  } catch (err: any) {
    if (err instanceof UnsafeUrlError) throw new NodeConfigError(err.message)
    throw err // network trouble: worth retrying
  }

  const isJson = /json/i.test(res.contentType)
  const text = res.body.toString('utf8')
  let parsed: unknown = text
  if (isJson) {
    try { parsed = JSON.parse(text) } catch { parsed = text }
  }
  let truncated = res.truncated
  if (typeof parsed === 'string' && parsed.length > MAX_RESPONSE_CHARS) { parsed = parsed.slice(0, MAX_RESPONSE_CHARS); truncated = true }

  const ok = res.status >= 200 && res.status < 300
  const output = { status: res.status, ok, url: res.url, contentType: res.contentType, headers: pickHeaders(res.headers), body: parsed, truncated }

  if (!ok && config.failOnError !== false) {
    const detail = typeof parsed === 'string' ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 200)
    const message = `The server answered ${res.status}${detail ? `: ${detail}` : ''}`
    if ([408, 425, 429].includes(res.status) || res.status >= 500) throw new RetryableHttpError(message)
    throw new NodeConfigError(message)
  }
  return output
}

const KEPT_HEADERS = /^(content-type|content-length|location|retry-after|etag|last-modified|x-request-id|x-ratelimit-.*|ratelimit-.*)$/
function pickHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => KEPT_HEADERS.test(name)))
}

// ---------------------------------------------------------------------------
// Web Fetch
// ---------------------------------------------------------------------------

export interface WebFetchConfig {
  url?: string
  maxChars?: number
}

export async function runWebFetchNode(config: WebFetchConfig, inputs: Record<string, any>, signal: AbortSignal | undefined, deps: NodeDeps = {}) {
  const url = interpolateVariables(String(config.url || ''), inputs).trim()
  if (!url) throw new NodeConfigError('The Web Fetch step has no URL.')
  if (/\{\{/.test(String(config.url)) && /\[[\w.-]+\]/.test(url)) {
    throw new NodeConfigError('The URL uses a value that is not available yet. Check the {{...}} placeholders.')
  }
  try {
    const page = await (deps.pageReader ?? readPage)(url, signal)
    const maxChars = clampInt(config.maxChars, 500, 30_000, 8_000)
    return {
      url: page.url,
      title: page.title,
      source: page.source,
      content: page.markdown.slice(0, maxChars),
      totalChars: page.markdown.length,
      truncated: page.markdown.length > maxChars
    }
  } catch (err: any) {
    if (err instanceof UnsafeUrlError) throw new NodeConfigError(err.message)
    // A missing page will still be missing next time; a slow or overloaded one may not be.
    if (err instanceof PageError && !/too long|timed out|temporar|try again|\b5\d\d\b/i.test(err.message)) throw new NodeConfigError(err.message)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Set / Transform
// ---------------------------------------------------------------------------

export interface SetField {
  key?: string
  value?: string
  /** text: placeholders are filled in. expression: a formula such as `a.result + 1`. json: placeholders are filled in, then the text is read as JSON. */
  mode?: 'text' | 'expression' | 'json'
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const FIELD_KEY = /^[A-Za-z_][\w-]{0,63}$/

export async function runSetNode(config: { fields?: SetField[] }, inputs: Record<string, any>) {
  const fields = (config.fields ?? []).slice(0, 50)
  if (!fields.length) throw new NodeConfigError('The Set step has no fields.')
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const key = String(field.key ?? '').trim()
    if (!FIELD_KEY.test(key) || FORBIDDEN_KEYS.has(key)) throw new NodeConfigError(`"${key}" is not a valid field name. Use letters, numbers, _ or -, starting with a letter.`)
    const raw = String(field.value ?? '')
    const mode = field.mode ?? 'text'
    try {
      if (mode === 'expression') out[key] = await jexl.eval(stripBraces(raw), inputs)
      else if (mode === 'json') out[key] = JSON.parse(interpolateVariables(raw, inputs))
      else out[key] = interpolateVariables(raw, inputs)
    } catch (err: any) {
      throw new NodeConfigError(`Field "${key}" could not be worked out: ${err?.message ?? 'invalid value'}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Loop ("for each")
// ---------------------------------------------------------------------------

/** Runs `fn` over `items` with at most `limit` at a time, keeping result order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export const LOOP_LIMITS = { default: 20, max: 50, agentMax: 10, concurrency: 3 } as const

/** Works out the list a loop goes over. Anything that is not a list is a setup error. */
export async function loopItems(expression: string | undefined, inputs: Record<string, any>): Promise<unknown[]> {
  const expr = stripBraces(String(expression ?? '')).trim()
  if (!expr) throw new NodeConfigError('The Loop step has no list to go over.')
  let value: unknown
  try {
    value = await jexl.eval(expr, inputs)
  } catch (err: any) {
    throw new NodeConfigError(`The list "${expr}" could not be worked out: ${err?.message ?? 'invalid expression'}`)
  }
  if (!Array.isArray(value)) throw new NodeConfigError(`"${expr}" is not a list (it is ${value === undefined || value === null ? 'empty' : typeof value}). A loop needs a list such as trigger.payload.urls.`)
  return value
}

export function loopCap(kind: string | undefined, maxItems: unknown): number {
  const cap = kind === 'agent' ? LOOP_LIMITS.agentMax : LOOP_LIMITS.max
  return clampInt(maxItems, 1, cap, Math.min(LOOP_LIMITS.default, cap))
}
