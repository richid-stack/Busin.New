import { lookup as dnsLookup } from 'node:dns'
import { promises as dns } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'

/**
 * Outbound requests made on a user's behalf (the agent reading a web page, a workflow calling an
 * API) must never reach our own network: localhost, private ranges, or the cloud metadata service
 * that hands out service-account credentials. Every check here runs on the address actually
 * connected to, so DNS tricks (rebinding, hostnames that point inward) do not get around it.
 */

export class UnsafeUrlError extends Error {}

const blocked = new BlockList()
const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]
const V6_BLOCKED: Array<[string, number]> = [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]
]
for (const [net, prefix] of V4_BLOCKED) blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of V6_BLOCKED) blocked.addSubnet(net, prefix, 'ipv6')

/** The IPv4 address embedded in an IPv4-mapped or NAT64 IPv6 address, if any. */
function embeddedV4(ip: string): string | null {
  const dotted = /^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (dotted) return dotted[1]!
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip)
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16)
    const lo = Number.parseInt(hex[2]!, 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return null
}

/** True only for globally routable addresses. Anything unparseable counts as unsafe. */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 0) return false
  if (family === 4) return !blocked.check(ip, 'ipv4')
  const v4 = embeddedV4(ip)
  if (v4) return isPublicIp(v4)
  return !blocked.check(ip, 'ipv6')
}

const BLOCKED_HOSTS = /^(localhost|metadata|metadata\.google\.internal|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i
const ALLOWED_PORTS = new Set(['', '80', '443'])

/** Validates the shape of a URL before any network traffic. Resolution is checked at connect time. */
export function parseSafeUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('That is not a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http and https links can be opened.')
  if (url.username || url.password) throw new UnsafeUrlError('Links with embedded credentials are not allowed.')
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError('Only the standard web ports (80 and 443) are allowed.')

  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTS.test(host)) throw new UnsafeUrlError('That address is not a public website.')
  if (isIP(host) !== 0 && !isPublicIp(host)) throw new UnsafeUrlError('That address is not a public website.')
  return url
}

/** DNS lookup that refuses to hand back any non-public address (runs on every connection). */
export const safeLookup: typeof dnsLookup = ((hostname: string, options: any, callback: any) => {
  const cb = typeof options === 'function' ? options : callback
  const opts = typeof options === 'function' ? {} : options
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses: any) => {
    if (err) return cb(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }]
    const bad = list.find((a: { address: string }) => !isPublicIp(a.address))
    if (bad || list.length === 0) return cb(new UnsafeUrlError('That address is not a public website.'))
    if (opts.all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}) as typeof dnsLookup

export interface SafeFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Defaults to GET. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  body?: string
  /** 'manual' returns a redirect response as it is instead of following it. */
  redirect?: 'follow' | 'manual'
}

export interface SafeFetchResult {
  status: number
  url: string
  contentType: string
  /** Response headers, lower-cased. Cookies are left out. */
  headers: Record<string, string>
  body: Buffer
  /** True when the page was larger than maxBytes and was cut off. */
  truncated: boolean
}

/** Reads a stream up to `maxBytes`, then stops and reports that it cut the data off. */
export async function readCapped(stream: Readable, maxBytes: number): Promise<{ body: Buffer, truncated: boolean }> {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (size + buf.length > maxBytes) {
      chunks.push(buf.subarray(0, maxBytes - size))
      truncated = true
      stream.destroy()
      break
    }
    chunks.push(buf)
    size += buf.length
  }
  return { body: Buffer.concat(chunks), truncated }
}

function decoded(res: IncomingMessage): Readable {
  switch ((res.headers['content-encoding'] || '').toLowerCase()) {
    case 'gzip': return res.pipe(createGunzip())
    case 'deflate': return res.pipe(createInflate())
    case 'br': return res.pipe(createBrotliDecompress())
    default: return res
  }
}

function once(url: URL, opts: Required<Pick<SafeFetchOptions, 'timeoutMs' | 'maxBytes'>> & SafeFetchOptions): Promise<{ res: IncomingMessage, close: () => void }> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const payload = opts.body === undefined ? undefined : Buffer.from(opts.body, 'utf8')
    const req = send(url, {
      method: opts.method ?? 'GET',
      lookup: safeLookup,
      timeout: opts.timeoutMs,
      headers: {
        'User-Agent': 'OpenLobsBot/1.0 (+https://openlobs.app)',
        'Accept': 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Encoding': 'gzip, br, deflate',
        ...opts.headers,
        ...(payload ? { 'Content-Length': String(payload.length) } : {})
      },
      signal: opts.signal
    }, res => resolve({ res, close: () => req.destroy() }))
    req.on('timeout', () => req.destroy(new Error('The website took too long to respond.')))
    req.on('error', reject)
    req.end(payload)
  })
}

/**
 * GET a public web page. Validates the URL, checks the address on every connection and every
 * redirect, bounds time and size, and never forwards credentials.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { timeoutMs: 10_000, maxBytes: 2_000_000, maxRedirects: 4, ...options }
  let url = parseSafeUrl(rawUrl)
  const firstOrigin = url.origin
  let current: typeof opts = opts

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const { res, close } = await once(url, current)
    const status = res.statusCode ?? 0
    const location = res.headers.location

    if (status >= 300 && status < 400 && location && opts.redirect !== 'manual') {
      res.resume()
      close()
      url = parseSafeUrl(new URL(location, url).href)
      // Credentials and custom headers never follow a redirect to another site, and a redirect that
      // turns a POST into a GET drops the body.
      current = { ...current }
      if (url.origin !== firstOrigin) current.headers = undefined
      if (status === 301 || status === 302 || status === 303) { current.method = 'GET'; current.body = undefined }
      continue
    }

    const stream = decoded(res)
    const timer = setTimeout(() => res.destroy(new Error('The website took too long to respond.')), opts.timeoutMs)
    try {
      const { body, truncated } = await readCapped(stream, opts.maxBytes)
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(res.headers)) {
        if (name !== 'set-cookie' && value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : String(value)
      }
      return { status, url: url.href, contentType: String(res.headers['content-type'] || ''), headers, body, truncated }
    } finally {
      clearTimeout(timer)
      close()
    }
  }
  throw new UnsafeUrlError('The page redirected too many times.')
}

/** Used by tests and diagnostics: resolves a host and reports whether every address is public. */
export async function resolvesToPublicOnly(host: string): Promise<boolean> {
  const addresses = await dns.lookup(host, { all: true })
  return addresses.length > 0 && addresses.every(a => isPublicIp(a.address))
}
