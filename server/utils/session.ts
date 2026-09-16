import { useSession, type HTTPEvent, type Session, getHeader } from 'nitro/h3'

export interface UserSession extends Session {
  user?: {
    id: string
    name: string
    avatar: string
    username: string
    email?: string
  }
}

export async function useUserSession (event: HTTPEvent) {
  const password = process.env.SESSION_SECRET || 'dev-session-secret-key-must-be-at-least-32-characters'
  const session = await useSession<UserSession>(event, {
    password,
    cookie: {
      sameSite: 'none',
      secure: true
    }
  })

  // Fallback: If header contains x-user-id and session.data.user is not yet defined
  const headerUserId = getHeader(event, 'x-user-id')
  if (headerUserId && !session.data.user) {
    session.data.user = {
      id: headerUserId,
      name: 'User',
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${headerUserId}`,
      username: headerUserId
    }
  }

  return session
}

