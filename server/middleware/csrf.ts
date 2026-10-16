import type { H3Event } from 'nitro'
import { defineHandler, HTTPError } from 'nitro'
import { getCookie, setCookie, getHeader, setResponseHeader } from 'nitro/h3'
import { randomUUID } from 'node:crypto'

const CSRF_COOKIE = 'csrf-token'
const CSRF_HEADER = 'x-csrf-token'
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']
const ALLOW_HEADERS = 'Content-Type, Authorization, x-csrf-token, Accept'
const ALLOW_METHODS = 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS'

function extraAllowedOrigins(): Set<string> {
  return new Set((process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean))
}

function isSameHost(origin: string, event: H3Event): boolean {
  try {
    const host = new URL(origin).host
    return host === getHeader(event, 'host') || host === getHeader(event, 'x-forwarded-host')
  } catch {
    return false
  }
}

export default defineHandler((event) => {
  const origin = getHeader(event, 'origin')
  const hasOrigin = Boolean(origin) && origin !== 'null'
  const trusted = hasOrigin && (isSameHost(origin!, event) || extraAllowedOrigins().has(origin!))

  setResponseHeader(event, 'Vary', 'Origin')

  if (trusted) {
    // Credentials (cookies) are only ever allowed for this app's own origin and explicitly listed origins.
    setResponseHeader(event, 'Access-Control-Allow-Origin', origin!)
    setResponseHeader(event, 'Access-Control-Allow-Credentials', 'true')
    setResponseHeader(event, 'Access-Control-Allow-Methods', ALLOW_METHODS)
    setResponseHeader(event, 'Access-Control-Allow-Headers', ALLOW_HEADERS)
    setResponseHeader(event, 'Access-Control-Expose-Headers', CSRF_HEADER)
  } else if (origin === 'null') {
    // Sandboxed previews send "null". They get no cookies, so only Bearer-token calls work from there.
    setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
    setResponseHeader(event, 'Access-Control-Allow-Methods', ALLOW_METHODS)
    setResponseHeader(event, 'Access-Control-Allow-Headers', ALLOW_HEADERS)
  }

  if (event.method === 'OPTIONS') {
    return ''
  }

  // Webhooks are authenticated by their own secret.
  const path = event.path || ''
  if (path.startsWith('/api/webhooks')) {
    return undefined
  }

  let token = getCookie(event, CSRF_COOKIE)
  if (!token) {
    token = randomUUID()
    setCookie(event, CSRF_COOKIE, token, { httpOnly: false, sameSite: 'none', secure: true, path: '/' })
  }
  setResponseHeader(event, CSRF_HEADER, token)

  if (!SAFE_METHODS.includes(event.method)) {
    // Requests that carry a Bearer token cannot be forged cross-site: browsers never attach it on their own.
    const hasBearer = /^Bearer\s+\S+/i.test(getHeader(event, 'authorization') || '')
    if (!hasBearer) {
      const fetchSite = getHeader(event, 'sec-fetch-site')
      const crossSite = fetchSite === 'cross-site' || (hasOrigin && !trusted)
      if (crossSite && !trusted) {
        throw new HTTPError({ statusCode: 403, statusMessage: 'Cross-site request blocked' })
      }
      if (crossSite && trusted && getHeader(event, CSRF_HEADER) !== token) {
        throw new HTTPError({ statusCode: 403, statusMessage: 'CSRF token mismatch' })
      }
    }
  }

  return undefined
})
