import { defineHandler } from 'nitro'
import { isMethod } from 'nitro/h3'
import { useUserSession, requireUser } from '../../utils/session'

export default defineHandler(async (event) => {
  if (isMethod(event, 'DELETE')) {
    const session = await useUserSession(event)
    await session.clear()
    return { success: true }
  }

  if (isMethod(event, 'POST')) {
    // Identity comes only from the verified Firebase ID token, never from the request body.
    const user = await requireUser(event)
    return { user }
  }

  // GET: `user` is present only when a valid Firebase ID token accompanies the request.
  const session = await useUserSession(event)
  return session.data
})
