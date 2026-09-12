import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../../../utils/session'
import { getChat, deleteChatMessages } from '../../../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const { messageId, type } = await readValidatedBody(event, z.object({
    messageId: z.string(),
    type: z.enum(['edit', 'regenerate'])
  }).parse)

  const chat = await getChat(id)
  const userId = session.data.user?.id || session.id!

  if (!chat || chat.userId !== userId) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Chat not found' })
  }

  const allMessages = chat.messages || []
  const targetIndex = allMessages.findIndex(m => m.id === messageId)
  if (targetIndex === -1) {
    throw new HTTPError({ statusCode: 404, statusMessage: 'Message not found' })
  }

  const targetRole = allMessages[targetIndex]!.role
  if (type === 'edit' && targetRole !== 'user') {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Can only edit user messages' })
  }
  if (type === 'regenerate' && targetRole !== 'assistant') {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Can only regenerate assistant messages' })
  }

  const startIndex = type === 'edit' ? targetIndex + 1 : targetIndex
  const idsToDelete = allMessages.slice(startIndex).map(m => m.id)

  if (idsToDelete.length > 0) {
    await deleteChatMessages(id, idsToDelete)
  }

  return { success: true }
})
