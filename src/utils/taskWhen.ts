import { buildCron, defaultSchedule } from './schedulePresets'
import type { ScheduleKind } from './schedulePresets'
import { toLocalInput } from './scheduleText'

export interface WhenState {
  mode: 'repeat' | 'once'
  kind: ScheduleKind
  time: string
  weekday: number
  monthDay: number
  custom: string
  timezone: string
  /** Value of a datetime-local input: the browser's own zone. */
  at: string
}

export function defaultWhen(): WhenState {
  return { mode: 'repeat', kind: 'weekdays', time: '09:00', weekday: 1, monthDay: 1, custom: '', timezone: defaultSchedule().timezone, at: toLocalInput(null) }
}

/** What the server is sent for a state: a cron and zone, or one exact moment. */
export function whenPayload(w: WhenState): { cron: string, timezone: string } | { runAt: string, timezone: string } {
  if (w.mode === 'once') return { runAt: w.at && Number.isFinite(new Date(w.at).getTime()) ? new Date(w.at).toISOString() : '', timezone: w.timezone }
  return { cron: w.kind === 'custom' ? w.custom.trim() : buildCron({ kind: w.kind, time: w.time, weekday: w.weekday, monthDay: w.monthDay }), timezone: w.timezone }
}
