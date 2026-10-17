import { auth } from './firebase'

/**
 * Attaches the signed-in user's Firebase ID token (`Authorization: Bearer ...`) to every
 * same-origin `/api/*` request. The server verifies the token; it never trusts an
 * identity sent any other way. Works for ofetch/$fetch and the AI SDK chat transport,
 * since both call `globalThis.fetch` at request time.
 */
export function installAuthFetch() {
  if (typeof window === 'undefined' || (globalThis.fetch as { __authFetch?: boolean }).__authFetch) return

  const originalFetch = globalThis.fetch.bind(globalThis)

  /** Adds the bearer token when possible. Resolves to null when the request goes out unchanged. */
  const withAuth = async (input: RequestInfo | URL, init?: RequestInit): Promise<RequestInit | null> => {
    try {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(rawUrl, window.location.href)
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return null

      await auth.authStateReady()
      const user = auth.currentUser
      if (!user) return null

      const token = await user.getIdToken()
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (!headers.has('authorization')) headers.set('Authorization', `Bearer ${token}`)
      return { ...init, headers }
    } catch {
      // Could not prepare credentials: send the request as it is.
      return null
    }
  }

  const authFetch: typeof fetch = async (input, init) => {
    const authorized = await withAuth(input, init)
    // The request itself runs outside the try block above: a network failure must reach the
    // caller, never trigger a silent second send of a request that may already have been processed.
    return originalFetch(input, authorized ?? init)
  }

  ;(authFetch as { __authFetch?: boolean }).__authFetch = true
  globalThis.fetch = authFetch
}
