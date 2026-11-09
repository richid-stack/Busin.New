import { WEEKDAYS, parseCron } from './schedulePresets'

const pad = (n: number) => String(n).padStart(2, '0')

/** "Every weekday at 09:00", "Once on Mon 2 Nov, 10:00": a repeating or one-time schedule in plain words. */
export function describeSchedule(s: { cron: string | null, runAt: string | null, timezone: string }): string {
  if (s.runAt) return `Once, ${formatMoment(s.runAt, s.timezone)}`
  const p = parseCron(s.cron ?? '')
  switch (p.kind) {
    case 'hourly': return `Every hour at :${p.time.split(':')[1]}`
    case 'daily': return `Every day at ${p.time}`
    case 'weekdays': return `Every weekday at ${p.time}`
    case 'weekly': return `Every ${WEEKDAYS.find(d => d.value === p.weekday)?.label ?? 'week'} at ${p.time}`
    case 'monthly': return `On day ${p.monthDay} of every month at ${p.time}`
    default: return `Cron ${s.cron}`
  }
}

/** A moment in the schedule's own time zone, e.g. "Mon 2 Nov, 10:00". */
export function formatMoment(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** The value a `datetime-local` input wants for a moment, in the browser's own zone. */
export function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3_600_000)
  if (!Number.isFinite(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
