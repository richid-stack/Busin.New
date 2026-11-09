import { defineHandler, HTTPError } from 'nitro'
import type { H3Event } from 'nitro'
import { getVerifiedUser, requireUser } from './session'
import type { UserSession } from './session'
import { enforceRateLimit, rateLimitSubject } from './rateLimit'
import { reef } from '../services/reef/reef'
import type { Reef } from '../services/reef/reef'
import { shareHttpError } from '../services/reef/http'
import { isReefAdmin } from '../services/reef/moderation'

type SessionUser = NonNullable<UserSession['user']>

interface Options {
  /** none: nobody needs to sign in and the person is not looked up. optional: read-only pages that show more to a signed-in person. */
  auth?: 'optional' | 'required' | 'admin'
  /** [scope, most calls, window in ms]. Reads default to 120 a minute. */
  limit?: [string, number, number]
}

export interface ReefContext {
  event: H3Event
  user: SessionUser | null
  /** The signed-in person. Only on `required` and `admin` routes. */
  me: SessionUser
  reef: Reef
}

/**
 * The one way every Reef route is written: who may call it, how often, and how errors turn into
 * messages a person can read. A route body only has to say what it does.
 */
export function reefHandler<T>(options: Options, run: (ctx: ReefContext) => Promise<T>) {
  const auth = options.auth ?? 'optional'
  return defineHandler(async (event) => {
    const user = auth === 'optional' ? await getVerifiedUser(event).catch(() => null) : await requireUser(event)
    // The review queue and badges do not announce themselves to anyone else.
    if (auth === 'admin' && !isReefAdmin(user)) throw new HTTPError({ statusCode: 404, statusMessage: 'Not found' })
    const [scope, max, windowMs] = options.limit ?? ['reef-read', 120, 60_000]
    enforceRateLimit(event, scope, auth === 'optional' ? rateLimitSubject(event, user?.id) : user!.id, max, windowMs)
    try {
      return await run({ event, user, me: user as SessionUser, reef: reef() })
    } catch (err) {
      shareHttpError(err)
    }
  })
}

export const WRITE = (scope: string, max = 40, windowMs = 10 * 60_000): [string, number, number] => [scope, max, windowMs]
