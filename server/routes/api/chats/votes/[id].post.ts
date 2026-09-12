import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../../utils/session'
import { getChat, setChatVote } from '../../../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const { messageId, isUpvoted } = await readValidatedBody(event, z.object({
    messageId: z.string(),
    isUpvoted: z.boolean().optional()
  }).parse)

  const chat = await getChat(id)
  const userId = session.data.user?.id || session.id!

  if (!chat || chat.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Chat not found' })
  }

  const message = chat.messages.find(m => m.id === messageId)

  if (!message) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Message not found' })
  }

  if (message.role !== 'assistant') {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Can only vote on assistant messages' })
  }

  await setChatVote(id, messageId, userId, isUpvoted)

  return { chatId: id, messageId, isUpvoted }
})
