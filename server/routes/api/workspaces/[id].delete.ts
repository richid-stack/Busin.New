import { defineHandler } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { workspaceStore } from '../../../services/workspaces/store'
import { workspaceRoute } from '../../../utils/workspaceRoute'

export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-write', user.id, 60, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  await workspaceStore().remove(user.id, id)
  return { ok: true }
}))
