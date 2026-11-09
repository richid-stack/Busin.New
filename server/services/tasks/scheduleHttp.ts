import { HTTPError } from 'nitro'
import { ScheduleError } from '../schedule/cron'
import { ScheduleStoreError } from './schedules'
import { TaskError } from './store'

/** Turns the errors a schedule can raise into a response the person can read. Anything else is rethrown. */
export function scheduleHttpError(err: unknown): never {
  if (err instanceof ScheduleError) throw new HTTPError({ statusCode: 400, statusMessage: err.message })
  if (err instanceof ScheduleStoreError) throw new HTTPError({ statusCode: err.code === 'not_found' ? 404 : err.code === 'limit' ? 429 : 400, statusMessage: err.message })
  if (err instanceof TaskError) throw new HTTPError({ statusCode: err.code === 'limit' ? 429 : err.code === 'not_found' ? 404 : 400, statusMessage: err.message })
  throw err
}
