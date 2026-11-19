import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { getFirebaseDb } from '../../../utils/firebaseAdmin'
import { GithubRunError } from '../../../services/cloudbox/github'
import { connectGithub } from '../../../services/cloudbox/githubStore'
import { cloudOverview } from '../../../services/cloudbox/overview'

/** Connects the person's own GitHub: checks the token, puts the runner in their repo, then stores the token sealed. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'github-connect', user.id, 8, 10 * 60_000)
  // A bad body never echoes what was sent: it may be a token.
  const { token } = await readValidatedBody(event, z.object({ token: z.string().trim().min(20).max(400) }).strict().parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Paste the token from GitHub.' })
  })
  const db = getFirebaseDb()
  try {
    await connectGithub(db, user.id, token)
  } catch (err: any) {
    if (err instanceof GithubRunError) throw new HTTPError({ statusCode: err.kind === 'busy' ? 429 : 400, statusMessage: err.message })
    console.error('[github] connect failed:', err?.name)
    throw new HTTPError({ statusCode: 500, statusMessage: 'GitHub could not be connected just now. Try again in a moment.' })
  }
  return await cloudOverview(db, user.id)
})
