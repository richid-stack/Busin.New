import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { workspaceStore } from '../../../../services/workspaces/store'
import { workspaceRoute } from '../../../../utils/workspaceRoute'

/** The notes of a workspace and its "where we are" summary. */
export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-read', user.id, 120, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  return await workspaceStore().listNotes(user.id, id)
}))
