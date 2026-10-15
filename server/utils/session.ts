import { useSession, type Session, getHeader } from 'nitro/h3'
import type { H3Event } from 'nitro'
import { HTTPError } from 'nitro'
import { getFirebaseAuth } from './firebaseAdmin'

export interface UserSession extends Session {
  user?: {
    id: string
    name: string
    avatar: string
    username: string
    email?: string
  }
}

const DEV_SESSION_SECRET = 'dev-session-secret-key-must-be-at-least-32-characters'

function getSessionPassword() {
  const password = process.env.SESSION_SECRET
  if (password) return password
  if (process.env.NODE_ENV === 'production') {
    // Never sign cookies with a key that is public in the repository.
    throw new HTTPError({
      statusCode: 500,
      statusMessage: 'SESSION_SECRET is not configured (must be at least 32 characters)'
    })
  }
  return DEV_SESSION_SECRET
}

type SessionUser = NonNullable<UserSession['user']>

/**
 * Verifies the Firebase ID token sent as `Authorization: Bearer <token>`.
 * Returns null when no token is sent, throws 401 when the token is invalid.
 */
export async function getVerifiedUser(event: H3Event): Promise<SessionUser | null> {
  const header = getHeader(event, 'authorization')
  if (!header) return null

  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) return null

  try {
    const decoded = await getFirebaseAuth().verifyIdToken(match[1])
    const email = decoded.email || undefined
    return {
      id: decoded.uid,
      name: (decoded.name as string | undefined) || email?.split('@')[0] || 'User',
      avatar: (decoded.picture as string | undefined) || `https://api.dicebear.com/7.x/bottts/svg?seed=${decoded.uid}`,
      username: (decoded.name as string | undefined) || email?.split('@')[0] || 'user',
      email
    }
  } catch (err) {
    console.warn('[auth] Invalid Firebase ID token:', (err as Error)?.message)
    throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid or expired authentication token' })
  }
}

/**
 * Returns the cookie session. The user on it is only ever populated from a verified
 * Firebase ID token; client-supplied identity (headers, request bodies) is never trusted.
 */
export async function useUserSession(event: H3Event) {
  const session = await useSession<UserSession>(event, {
    password: getSessionPassword(),
    cookie: {
      sameSite: 'none',
      secure: true
    }
  })

  const verified = await getVerifiedUser(event)
  if (verified) {
    session.data.user = verified
  }

  return session
}

/** Requires a signed-in user (verified Firebase ID token) or throws 401. */
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await getVerifiedUser(event)
  if (!user) {
    throw new HTTPError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return user
}
