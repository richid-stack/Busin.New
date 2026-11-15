import { defineHandler } from 'nitro'
import { getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { importRepo } from '../../../../services/workspaces/github'
import { workspaceStore } from '../../../../services/workspaces/store'
import { workspaceRoute } from '../../../../utils/workspaceRoute'

/** Adds a public GitHub repository to a workspace as one text file: what it is, its files and its README. */
export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-import', user.id, 15, 10 * 60_000)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().min(1).max(128) }).parse)
  const { repo } = await readValidatedBody(event, z.object({ repo: z.string().min(3).max(300) }).parse)
  const store = workspaceStore()
  await store.owned(user.id, id)
  const found = await importRepo(repo)
  return await store.addFile(user.id, id, { name: found.name, text: found.text }, 'github', found.from)
}))
