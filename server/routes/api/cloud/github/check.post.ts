import { defineHandler, HTTPError } from 'nitro'
import { requireUser } from '../../../../utils/session'
import { enforceRateLimit } from '../../../../utils/rateLimit'
import { getFirebaseDb } from '../../../../utils/firebaseAdmin'
import { SecretBoxError } from '../../../../utils/secretBox'
import { GithubRunError } from '../../../../services/cloudbox/github'
import { recheckGithub } from '../../../../services/cloudbox/githubStore'
import { cloudOverview } from '../../../../services/cloudbox/overview'

/** Checks the stored token again and brings the runner in the repo up to date. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'github-check', user.id, 10, 10 * 60_000)
  const db = getFirebaseDb()
  try {
    await recheckGithub(db, user.id)
  } catch (err: any) {
    if (err instanceof GithubRunError) throw new HTTPError({ statusCode: err.kind === 'busy' ? 429 : 400, statusMessage: err.message })
    if (err instanceof SecretBoxError) throw new HTTPError({ statusCode: 400, statusMessage: 'The saved token could not be read. Disconnect and connect GitHub again.' })
    console.error('[github] check failed:', err?.name)
    throw new HTTPError({ statusCode: 500, statusMessage: 'GitHub could not be checked just now. Try again in a moment.' })
  }
  return await cloudOverview(db, user.id)
})
