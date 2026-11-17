import { defineHandler } from 'nitro'
import { getValidatedRouterParams, readBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { workspaceStore } from '../../../../services/workspaces/store'
import { workspaceRoute } from '../../../../utils/workspaceRoute'

/** The person edits the "where we are" summary. An empty text clears it. */
export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-note', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  return { whereWeAre: await workspaceStore().setWhereWeAre(user.id, id, await readBody(event), 'you') }
}))
