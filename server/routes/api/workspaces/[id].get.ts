import { defineHandler, HTTPError } from 'nitro'
import { getValidatedRouterParams } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { workspaceStore } from '../../../services/workspaces/store'
import { workspaceRoute } from '../../../utils/workspaceRoute'

export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const store = workspaceStore()
  const workspace = await store.get(user.id, id)
  if (!workspace) throw new HTTPError({ statusCode: 404, statusMessage: 'Workspace not found' })
  return { workspace, ...(await store.listFiles(user.id, id)) }
}))
