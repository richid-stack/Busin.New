import { defineHandler } from 'nitro'
import { readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { requireUser } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rateLimit'
import { ScheduleError, defaultMinIntervalMinutes, nextRun, upcomingRuns } from '../../../services/schedule/cron'
import { taskMinIntervalMinutes } from '../../../services/tasks/schedules'

/** Shows when a schedule would run next, or why it cannot be used, so the editor can tell before saving. */
export default defineHandler(async (event) => {
  const user = await requireUser(event)
  enforceRateLimit(event, 'schedule-preview', user.id, 60, 60_000)

  const body = await readValidatedBody(event, z.object({
    cron: z.string().max(100),
    timezone: z.string().max(64).optional(),
    /** Tasks cost more per run than workflows, so their shortest gap is longer. */
    for: z.enum(['workflow', 'task']).optional()
  }).parse)

  const config = { cron: body.cron, timezone: body.timezone || 'UTC' }
  try {
    nextRun(config, new Date(), body.for === 'task' ? taskMinIntervalMinutes() : defaultMinIntervalMinutes())
    return { ok: true, runs: upcomingRuns(config, new Date(), 5).map(d => d.toISOString()) }
  } catch (err) {
    if (err instanceof ScheduleError) return { ok: false, error: err.message }
    throw err
  }
})
