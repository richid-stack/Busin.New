import { defineHandler } from 'nitro'
import { isMethod, readBody } from 'nitro/h3'
import { useUserSession } from '../../utils/session'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  if (isMethod(event, 'DELETE')) {
    await session.clear()
    return { success: true }
  }

  if (isMethod(event, 'POST')) {
    const body = await readBody(event)
    if (body?.user) {
      await session.update({
        user: {
          id: String(body.user.id),
          name: String(body.user.name || body.user.displayName || 'User'),
          avatar: String(body.user.avatar || body.user.photoURL || ''),
          username: String(body.user.username || body.user.email?.split('@')[0] || 'user')
        }
      })
    }
    return session.data
  }

  return session.data
})
