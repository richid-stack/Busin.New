import { defineHandler } from 'nitro'
import { getValidatedQuery } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { listRepo } from '../../../services/workspaces/github'
import { MAX_TOTAL_CHARS } from '../../../services/workspaces/profile'
import { workspaceRoute } from '../../../utils/workspaceRoute'

/** The top level of a public repository, with how much readable text each folder holds, so the person can pick what to add. */
export default defineHandler(event => workspaceRoute(async () => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'workspace-import', user.id, 15, 10 * 60_000)
  const { repo } = await getValidatedQuery(event, z.object({ repo: z.string().min(3).max(300) }).parse)
  return { ...(await listRepo(repo)), limitChars: MAX_TOTAL_CHARS }
}))
