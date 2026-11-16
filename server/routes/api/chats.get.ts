import { defineHandler } from 'nitro'
import { useUserSession } from '../../utils/session'
import { getUserChats, sweepGhostChats } from '../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  // A ghost chat that was never cleaned up (the tab was closed) goes now. It never blocks the list.
  sweepGhostChats(userId).catch(err => console.warn('[ghost] sweep failed:', err?.message))

  return await getUserChats(userId)
})
