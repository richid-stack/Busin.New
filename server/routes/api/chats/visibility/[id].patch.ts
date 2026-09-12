import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { useUserSession } from '../../../../utils/session'
import { getChat, updateChatVisibility } from '../../../../utils/firebase'
import { z } from 'zod'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const { visibility } = await readValidatedBody(event, z.object({
    visibility: z.enum(['public', 'private'])
  }).parse)

  const chat = await getChat(id)
  const userId = session.data.user?.id || session.id!

  if (!chat || chat.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Chat not found' })
  }

  await updateChatVisibility(id, visibility)

  return { ...chat, visibility }
})
