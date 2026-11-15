import { defineHandler } from 'nitro'
import { readBody } from 'nitro/h3'
import { requireUser } from '../../utils/session'
import { enforceRateLimit } from '../../utils/rateLimit'
import { workspaceStore } from '../../services/workspaces/store'
import { workspaceRoute } from '../../utils/workspaceRoute'

export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-write', user.id, 30, 10 * 60_000)
  return await workspaceStore().create(user.id, await readBody(event))
}))
