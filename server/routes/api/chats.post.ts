import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { useUserSession } from '../../utils/session'
import { createChat } from '../../utils/firebase'
import { enforceRateLimit, rateLimitSubject } from '../../utils/rateLimit'
import { MAX_INPUT_CHARS, allowAnonymousChat, assertNewChatMessage } from '../../utils/limits'

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  const { input, attachments } = await readValidatedBody(event, z.object({
    input: z.string().max(MAX_INPUT_CHARS).optional().default(''),
    attachments: z.array(z.object({
      name: z.string().max(255).optional(),
      contentType: z.string().max(255).optional(),
      url: z.string().refine(url => /^data:/i.test(url), 'Attachments must be uploaded files')
    })).optional()
  }).parse)

  const signedIn = Boolean(session.data.user?.id)
  if (!signedIn && !allowAnonymousChat()) {
    throw new HTTPError({ statusCode: 401, statusMessage: 'Sign in to start a chat.' })
  }
  const userId = session.data.user?.id || session.id!
  enforceRateLimit(event, 'chat-create', rateLimitSubject(event, signedIn ? userId : undefined), signedIn ? 60 : 20, 10 * 60_000)
  assertNewChatMessage(input, attachments)

  const initialTitle = input && input.trim()
    ? input.trim().replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ').slice(0, 36)
    : 'New Chat'

  const chat = await createChat({
    userId,
    title: initialTitle,
    initialMessage: input,
    attachments
  })

  if (!chat) {
    throw new HTTPError({ statusCode: 500, statusMessage: 'Failed to create chat' })
  }

  return chat
})
