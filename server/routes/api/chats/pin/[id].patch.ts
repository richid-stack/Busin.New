import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { getChat, updateChatPinned } from '../../../../utils/firebase'

/** Pins a chat to the top of the history, or unpins it. Only the owner can. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'chat-pin', user.id, 120, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const { pinned } = await readValidatedBody(event, z.object({ pinned: z.boolean() }).parse)

  const chat = await getChat(id)
  if (!chat || chat.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Chat not found' })
  if (chat.ghost) throw new HTTPError({ statusCode: 400, statusMessage: 'A ghost chat cannot be pinned.' })

  await updateChatPinned(id, pinned)
  return { id, pinned }
})
