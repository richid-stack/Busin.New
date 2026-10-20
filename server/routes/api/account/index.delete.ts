import { defineHandler, HTTPError } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireRecentSignIn } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { AccountDeletionError, defaultAccountDeps, eraseUserData } from '../../../services/account/account'

/** Deletes the account and everything in it. The person must type DELETE and have signed in recently. */
export default defineHandler(async (event) => {
  const user = await requireRecentSignIn(event)
  enforceRateLimit(event, 'account-delete', user.id, 3, 10 * 60_000)

  await readValidatedBody(event, z.object({ confirm: z.literal('DELETE') }).parse).catch(() => {
    throw new HTTPError({ statusCode: 400, statusMessage: 'Type DELETE to confirm.' })
  })

  try {
    const { removed } = await eraseUserData(defaultAccountDeps(), user.id)
    return { success: true, removed }
  } catch (err) {
    if (err instanceof AccountDeletionError) throw new HTTPError({ statusCode: 502, statusMessage: err.message })
    throw err
  }
})
