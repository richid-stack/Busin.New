const CSRF_COOKIE = 'csrf-token'
const CSRF_HEADER = 'x-csrf-token'

let inMemoryToken = ''

function getCsrfToken(): string {
  try {
    const match = typeof document !== 'undefined' ? document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`)) : null
    if (match?.[1]) {
      inMemoryToken = match[1]
      return match[1]
    }
  } catch {
    // Access to cookies might be restricted in certain iframe contexts
  }

  if (inMemoryToken) {
    return inMemoryToken
  }

  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(CSRF_COOKIE) : null
    if (stored) {
      inMemoryToken = stored
      return stored
    }
  } catch {
    // localStorage might be unavailable
  }

  return ''
}

export function setCsrfToken(token: string) {
  if (!token) return
  inMemoryToken = token
  try {
    localStorage.setItem(CSRF_COOKIE, token)
  } catch {
    // ignore
  }
}

export function useCsrf() {
  return {
    csrf: getCsrfToken,
    setCsrf: setCsrfToken,
    headerName: CSRF_HEADER
  }
}

