import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../utils/session'
import { createChat } from '../../utils/firebase'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  const { input, attachments } = await readValidatedBody(event, z.object({
    input: z.string().optional().default(''),
    attachments: z.array(z.object({
      name: z.string().optional(),
      contentType: z.string().optional(),
      url: z.string()
    })).optional()
  }).parse)

  const userId = session.data.user?.id || session.id!
  const chat = await createChat({
    userId,
    title: '',
    initialMessage: input,
    attachments
  })

  if (!chat) {
    throw new HTTPError({ statusCode: 500, statusMessage: 'Failed to create chat' })
  }

  return chat
})
