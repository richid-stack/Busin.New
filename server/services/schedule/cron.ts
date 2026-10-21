import { CronExpressionParser } from 'cron-parser'

export interface ScheduleConfig {
  /** Five fields: minute hour day-of-month month day-of-week. */
  cron?: string
  /** An IANA time zone such as "Africa/Accra". */
  timezone?: string
}

/** Shortest allowed gap between two runs. Each run can cost AI calls, so frequent schedules are opt-in. */
export const defaultMinIntervalMinutes = () => {
  const fromEnv = Number(process.env.SCHEDULE_MIN_MINUTES)
  return Number.isFinite(fromEnv) && fromEnv >= 1 ? Math.floor(fromEnv) : 15
}

/** How many workflows one user may have switched on with a schedule. */
export const MAX_SCHEDULED_PER_USER = 5
/** A scheduled workflow that fails this many runs in a row is paused. */
export const MAX_CONSECUTIVE_FAILURES = 5

export class ScheduleError extends Error {}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** Parses a schedule and returns its next run times after `from`. Throws ScheduleError with a user-facing message. */
export function upcomingRuns(config: ScheduleConfig, from: Date, count = 1): Date[] {
  const cron = String(config.cron ?? '').trim().replace(/\s+/g, ' ')
  const timezone = String(config.timezone || 'UTC')
  if (!cron) throw new ScheduleError('Choose when this workflow should run.')
  if (cron.split(' ').length !== 5) throw new ScheduleError('A schedule needs five parts: minute, hour, day of month, month and day of week (for example "0 9 * * 1-5").')
  if (!isValidTimeZone(timezone)) throw new ScheduleError(`"${timezone}" is not a known time zone.`)

  try {
    const it = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone })
    return Array.from({ length: count }, () => it.next().toDate())
  } catch (err: any) {
    // A schedule that matches no real date (like 31 February) ends up here as well.
    throw new ScheduleError(`That schedule is not valid: ${String(err?.message ?? 'unknown problem').replace(/^.*?error,?\s*/i, '')}`)
  }
}

/** The next run after `from`, after checking the schedule is not more frequent than allowed. */
export function nextRun(config: ScheduleConfig, from: Date, minIntervalMinutes = defaultMinIntervalMinutes()): Date {
  // Looking at a good stretch of future runs catches uneven schedules such as "0,5 9 * * *".
  const runs = upcomingRuns(config, from, 60)
  for (let i = 1; i < runs.length; i++) {
    const gap = (runs[i]!.getTime() - runs[i - 1]!.getTime()) / 60_000
    if (gap < minIntervalMinutes) {
      throw new ScheduleError(`That schedule runs every ${Math.max(1, Math.round(gap))} minute(s). The shortest allowed gap is ${minIntervalMinutes} minutes.`)
    }
  }
  return runs[0]!
}

interface NodeLike { type?: string, data?: Record<string, any> }

/** The schedule trigger of a workflow, if it has one. */
export function findScheduleNode<T extends NodeLike>(nodes: T[] | undefined): T | undefined {
  return (nodes ?? []).find(n => n.type === 'trigger' && n.data?.subtype === 'schedule')
}

export interface ScheduleFields {
  scheduleNextRunAt: string | null
  scheduleError: string | null
  scheduleFailures: number
}

/**
 * Works out what to store on a workflow so the timer endpoint can find it: the next run time while
 * it is active and has a schedule, nothing otherwise. Throws ScheduleError for an active workflow
 * whose schedule is not usable, so saving it fails with a clear message.
 */
export function scheduleFieldsFor(workflow: { status?: string, nodes?: NodeLike[] }, now: Date): ScheduleFields {
  const node = findScheduleNode(workflow.nodes)
  const off: ScheduleFields = { scheduleNextRunAt: null, scheduleError: null, scheduleFailures: 0 }
  if (!node || workflow.status !== 'active') return off
  const next = nextRun(node.data?.schedule ?? {}, now)
  return { scheduleNextRunAt: next.toISOString(), scheduleError: null, scheduleFailures: 0 }
}
