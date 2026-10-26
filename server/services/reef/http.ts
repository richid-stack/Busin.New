import { HTTPError } from 'nitro'
import { AccountDeletingError } from '../account/tombstone'
import { ShareError } from './share'

/** Turns a share error into a response the person can read. A blocked share carries the findings in `data.scan`. */
export function shareHttpError(err: unknown): never {
  if (err instanceof ShareError) {
    const statusCode = err.code === 'not_found' ? 404 : err.code === 'limit' ? 429 : err.code === 'blocked' ? 422 : err.code === 'conflict' ? 409 : 400
    throw new HTTPError({ statusCode, statusMessage: err.message, ...(err.scan ? { data: { scan: err.scan } } : {}) })
  }
  if (err instanceof AccountDeletingError) throw new HTTPError({ statusCode: 409, statusMessage: err.message })
  throw err
}
