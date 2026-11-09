import { HTTPError } from 'nitro'
import { AccountDeletingError } from '../account/tombstone'
import { ReefError } from './model'

const STATUS = { not_found: 404, limit: 429, blocked: 422, conflict: 409, forbidden: 403, taken: 409, no_profile: 409, invalid: 400 } as const

/** Turns a Reef error into a response the person can read. A blocked one carries the findings in `data.scan`; `data.code` says what kind it is. */
export function shareHttpError(err: unknown): never {
  if (err instanceof ReefError) throw new HTTPError({ statusCode: STATUS[err.code], statusMessage: err.message, data: { code: err.code, ...(err.data ?? {}) } })
  if (err instanceof AccountDeletingError) throw new HTTPError({ statusCode: 409, statusMessage: err.message })
  throw err
}
