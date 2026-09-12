import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { useUserSession } from '../../../utils/session'
import { getChat, deleteChat } from '../../../utils/firebase'
import { z } from 'zod'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const chat = await getChat(id)
  const userId = session.data.user?.id || session.id!

  if (!chat || chat.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Chat not found' })
  }

  await deleteChat(id)
  return [{ id }]
})
