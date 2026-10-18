/** Plain-language schedule choices that turn into a standard five-field cron expression. */
export type ScheduleKind = 'every-15' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom'

export interface ScheduleParts {
  kind: ScheduleKind
  /** "HH:mm" for daily, weekdays, weekly and monthly. For hourly only the minutes are used. */
  time: string
  /** 0 (Sunday) to 6 (Saturday), for weekly. */
  weekday: number
  /** 1 to 28, for monthly. Days 29 to 31 are left out so every month has a run. */
  monthDay: number
}

export const SCHEDULE_KINDS: Array<{ value: ScheduleKind, label: string }> = [
  { value: 'every-15', label: 'Every 15 minutes' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'monthly', label: 'Once a month' },
  { value: 'custom', label: 'Custom (cron)' }
]

export const WEEKDAYS = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }, { value: 0, label: 'Sunday' }
]

const pad = (n: number) => String(n).padStart(2, '0')

function splitTime(time: string): { h: number, m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  const h = match ? Number(match[1]) : 9
  const m = match ? Number(match[2]) : 0
  return { h: Math.min(23, Math.max(0, h)), m: Math.min(59, Math.max(0, m)) }
}

export function buildCron(parts: ScheduleParts): string {
  const { h, m } = splitTime(parts.time)
  switch (parts.kind) {
    case 'every-15': return '*/15 * * * *'
    case 'hourly': return `${m} * * * *`
    case 'daily': return `${m} ${h} * * *`
    case 'weekdays': return `${m} ${h} * * 1-5`
    case 'weekly': return `${m} ${h} * * ${parts.weekday}`
    case 'monthly': return `${m} ${h} ${Math.min(28, Math.max(1, parts.monthDay))} * *`
    default: return ''
  }
}

/** Reads a cron expression back into form fields; anything unusual stays "custom". */
export function parseCron(cron: string): ScheduleParts {
  const base: ScheduleParts = { kind: 'custom', time: '09:00', weekday: 1, monthDay: 1 }
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return base
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string]
  if (cron.trim() === '*/15 * * * *') return { ...base, kind: 'every-15' }
  const num = (s: string) => (/^\d{1,2}$/.test(s) ? Number(s) : null)
  const m = num(min)
  const h = num(hour)
  if (m === null || m > 59) return base
  if (hour === '*' && dom === '*' && mon === '*' && dow === '*') return { ...base, kind: 'hourly', time: `00:${pad(m)}` }
  if (h === null || h > 23 || mon !== '*') return base
  const time = `${pad(h)}:${pad(m)}`
  if (dom === '*' && dow === '*') return { ...base, kind: 'daily', time }
  if (dom === '*' && dow === '1-5') return { ...base, kind: 'weekdays', time }
  const d = num(dow)
  if (dom === '*' && d !== null && d <= 6) return { ...base, kind: 'weekly', time, weekday: d }
  const day = num(dom)
  if (dow === '*' && day !== null && day >= 1 && day <= 28) return { ...base, kind: 'monthly', time, monthDay: day }
  return base
}

export function defaultSchedule(timezone?: string): { cron: string, timezone: string } {
  let zone = timezone
  if (!zone) {
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* keep UTC */ }
  }
  return { cron: '0 9 * * 1-5', timezone: zone || 'UTC' }
}
