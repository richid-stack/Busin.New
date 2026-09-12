import { defineHandler } from 'nitro'
import { useUserSession } from '../../utils/session'
import { getUserChats } from '../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)
  const userId = session.data.user?.id || session.id!

  return await getUserChats(userId)
})
