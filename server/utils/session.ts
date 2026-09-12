import { useSession, type HTTPEvent, type Session } from 'nitro/h3'

export interface UserSession extends Session {
  user?: {
    id: string
    name: string
    avatar: string
    username: string
  }
}

export function useUserSession (event: HTTPEvent) {
  const password = process.env.SESSION_SECRET || 'dev-session-secret-key-must-be-at-least-32-characters'
  return useSession<UserSession>(event, {
    password,
    cookie: {
      sameSite: 'none',
      secure: true
    }
  })
}
