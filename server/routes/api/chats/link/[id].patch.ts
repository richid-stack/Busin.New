import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { getChat } from '../../../../utils/firebase'
import { getFirebaseDb } from '../../../../utils/firebaseAdmin'
import { getAgent } from '../../../../services/agents/store'
import { workspaceStore } from '../../../../services/workspaces/store'

/**
 * Moves a chat into a workspace (or out of one) and switches its agent. Null clears the link; a field left out stays as it is.
 * Both must belong to the signed-in owner of the chat, exactly as when a chat is started.
 */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'chat-link', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const body = await readValidatedBody(event, z.object({
    workspaceId: z.string().min(1).max(128).nullable().optional(),
    agentId: z.string().min(1).max(128).nullable().optional()
  }).refine(b => b.workspaceId !== undefined || b.agentId !== undefined, 'Nothing to change.').parse)

  const chat = await getChat(id)
  if (!chat || chat.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Chat not found' })

  if (body.workspaceId) {
    if (!await workspaceStore().get(user.id, body.workspaceId)) throw new HTTPError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }
  if (body.agentId) {
    const agent = await getAgent(body.agentId)
    if (!agent || agent.userId !== user.id) throw new HTTPError({ statusCode: 404, statusMessage: 'Agent not found' })
  }

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.workspaceId !== undefined) update.workspaceId = body.workspaceId ?? FieldValue.delete()
  if (body.agentId !== undefined) update.agentId = body.agentId ?? FieldValue.delete()
  await getFirebaseDb().collection('chats').doc(id).update(update)
  if (body.workspaceId) await workspaceStore().touch(user.id, body.workspaceId)

  return {
    workspaceId: body.workspaceId === undefined ? chat.workspaceId ?? null : body.workspaceId,
    agentId: body.agentId === undefined ? chat.agentId ?? null : body.agentId
  }
})
