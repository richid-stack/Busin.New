import { defineHandler, HTTPError } from 'nitro'
import { getHeader } from 'nitro/h3'
import { processQueue } from '../../../services/tasks/run'
import { runDueTaskSchedules } from '../../../services/tasks/scheduleTick'
import { taskScheduleStore } from '../../../services/tasks/schedules'
import { taskStore } from '../../../services/tasks/store'
import { holdStore, processHolds } from '../../../services/browser/holds'
import { defaultBrowserService } from '../../../services/browser/service'
import { defaultNotifyDeps, notifyNeedsYou } from '../../../services/notifications/notify'
import { secretMatches } from '../../../utils/secretCompare'

/** The timer endpoint for tasks: makes tasks for schedules that are due, then starts waiting tasks and takes over ones whose worker stopped. Same secret as the workflow timer. */
export default defineHandler(async (event) => {
  const expected = process.env.CRON_SECRET || ''
  if (expected.length < 16) throw new HTTPError({ statusCode: 404, statusMessage: 'Not found' })
  const bearer = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  const provided = bearer || getHeader(event, 'x-cron-secret') || ''
  if (!secretMatches(provided, expected)) throw new HTTPError({ statusCode: 401, statusMessage: 'Invalid or missing secret' })
  // Schedules first, so the tasks they make are picked up by the queue in this same call.
  const schedules = await runDueTaskSchedules({
    store: taskScheduleStore(),
    createTask: (userId, input, scheduleId) => taskStore().create(userId, input, { scheduleId }),
    getTask: (userId, id) => taskStore().get(userId, id)
  }).catch((err) => {
    console.error('[task-schedule] timer pass failed:', err?.message)
    return null
  })
  // Pages waiting for a person: email the ones nobody is looking at, and close the ones that waited too long.
  const holds = await processHolds({
    store: holdStore(),
    service: defaultBrowserService(),
    notify: hold => notifyNeedsYou(defaultNotifyDeps(), hold),
    onExpired: async (hold) => { if (hold.kind === 'task') await taskStore().expireWaiting(hold.userId, hold.ref) }
  }).catch((err) => {
    console.error('[browser-hold] timer pass failed:', err?.message)
    return null
  })
  const queue = await processQueue({ budgetMs: 120_000, maxTasks: 5 })
  return { ...queue, schedules, holds }
})
