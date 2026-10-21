import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable, Transform } from 'node:stream'
import { UnsafeUrlError, parseSafeUrl, safeLookup } from '../../utils/netSafety'
import { hostAllowed } from './allowList'

/**
 * A `fetch` for talking to a user's MCP server. MCP over HTTP streams its answers, so unlike the
 * buffered `safeFetch` this hands back a streaming Response. It keeps the same guarantees: only public
 * addresses (checked on the address actually connected to), no redirects followed, a cap on how much
 * a server may send back, and the caller's abort signal honoured.
 */
export interface StreamFetchOptions {
  /** Most bytes accepted in one response body. */
  maxResponseBytes?: number
  /** Time allowed to get a response started. */
  connectTimeoutMs?: number
  /** Tests swap these to talk to a local server. */
  validateUrl?: (url: string) => URL
  lookup?: typeof safeLookup
}

const NO_BODY = new Set([101, 204, 205, 304])

function toHeaders(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(init).forEach((value, name) => { out[name] = value })
  return out
}

export function createStreamingFetch(options: StreamFetchOptions = {}): typeof fetch {
  const maxBytes = options.maxResponseBytes ?? 2_000_000
  const connectTimeout = options.connectTimeoutMs ?? 10_000
  const validate = options.validateUrl ?? ((raw: string) => {
    const url = parseSafeUrl(raw)
    if (url.protocol !== 'https:') throw new UnsafeUrlError('MCP servers must use https.')
    // Checked on every connection, so narrowing MCP_ALLOWED_HOSTS also stops servers that were added earlier.
    if (!hostAllowed(url.hostname)) throw new UnsafeUrlError('This deployment only allows MCP servers on an approved list, and that address is not on it.')
    return url
  })
  const lookup = options.lookup ?? safeLookup

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = validate(raw)
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
    const headers = { ...toHeaders(typeof input === 'object' && 'headers' in input ? input.headers : undefined), ...toHeaders(init?.headers) }
    delete headers.host
    headers['accept-encoding'] = 'identity'
    const body = init?.body == null ? undefined : typeof init.body === 'string' ? Buffer.from(init.body) : init.body instanceof Uint8Array ? Buffer.from(init.body) : null
    if (body === null) throw new TypeError('Unsupported request body for an MCP request.')
    if (body) headers['content-length'] = String(body.length)

    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    return await new Promise<Response>((resolve, reject) => {
      const req = send(url, { method, headers, lookup, signal: init?.signal ?? undefined }, (res) => {
        clearTimeout(timer)
        const status = res.statusCode ?? 0
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(res.headers)) {
          if (name === 'set-cookie' || value === undefined) continue
          responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value))
        }
        if (NO_BODY.has(status)) {
          res.resume()
          resolve(new Response(null, { status, headers: responseHeaders }))
          return
        }
        let seen = 0
        const limited = new Transform({
          transform(chunk, _enc, done) {
            seen += chunk.length
            if (seen > maxBytes) done(new Error('The MCP server sent more data than allowed.'))
            else done(null, chunk)
          }
        })
        res.on('error', err => limited.destroy(err))
        res.pipe(limited)
        resolve(new Response(Readable.toWeb(limited) as unknown as ReadableStream, { status, statusText: res.statusMessage, headers: responseHeaders }))
      })
      const timer = setTimeout(() => req.destroy(new Error('The MCP server took too long to answer.')), connectTimeout)
      req.on('error', (err) => { clearTimeout(timer); reject(err) })
      req.end(body)
    })
  }) as typeof fetch
}
