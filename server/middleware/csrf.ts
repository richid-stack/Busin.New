import { defineHandler, HTTPError } from 'nitro'
import { getCookie, setCookie, getHeader, setResponseHeader } from 'nitro/h3'
import { randomUUID } from 'node:crypto'

const CSRF_COOKIE = 'csrf-token'
const CSRF_HEADER = 'x-csrf-token'
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

export default defineHandler((event) => {
  const origin = getHeader(event, 'origin')

  // Set CORS response headers only when origin is provided by the client
  if (origin && origin !== 'null') {
    setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
    setResponseHeader(event, 'Access-Control-Allow-Credentials', 'true')
    setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS')
    setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token, Accept')
    setResponseHeader(event, 'Access-Control-Expose-Headers', 'x-csrf-token')
  }

  // Handle preflight OPTIONS requests immediately
  if (event.method === 'OPTIONS') {
    if (!origin || origin === 'null') {
      setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
      setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS')
      setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token, Accept')
    }
    return ''
  }

  // Exempt webhooks and third-party callback endpoints
  const path = event.path || ''
  if (path.startsWith('/api/webhooks')) {
    return undefined
  }

  let token = getCookie(event, CSRF_COOKIE)
  let isNewToken = false

  if (!token) {
    token = randomUUID()
    isNewToken = true
    setCookie(event, CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'none',
      secure: true,
      path: '/'
    })
  }

  // Always expose the CSRF token in response header for client inspection
  setResponseHeader(event, CSRF_HEADER, token)

  if (!SAFE_METHODS.includes(event.method)) {
    const secFetchSite = getHeader(event, 'sec-fetch-site')
    const headerToken = getHeader(event, CSRF_HEADER)

    // Only reject if it's explicitly a cross-site request with an existing session token mismatch
    if (!isNewToken && secFetchSite === 'cross-site') {
      if (!headerToken || headerToken !== token) {
        throw new HTTPError({ statusCode: 403, statusMessage: 'CSRF token mismatch' })
      }
    }
  }

  return undefined
})
