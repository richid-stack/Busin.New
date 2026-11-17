/** Settings > Defaults. Kept on this device, like Appearance. */
export type EnterKey = 'enter' | 'mod'
export type TimeStyle = 'relative' | 'exact'
export interface Preferences {
  /** '' keeps whatever model was used last; otherwise the model every new chat starts with. */
  newChatModel: string
  /** 'enter': Enter sends and Shift+Enter adds a line. 'mod': Ctrl or Cmd+Enter sends and Enter adds a line. */
  enterSends: EnterKey
  timeStyle: TimeStyle
}

export const DEFAULT_PREFERENCES: Preferences = { newChatModel: '', enterSends: 'enter', timeStyle: 'relative' }

export function parsePreferences(raw: string | null | undefined): Preferences {
  const out = { ...DEFAULT_PREFERENCES }
  if (!raw) return out
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') {
      if (typeof v.newChatModel === 'string' && v.newChatModel.length <= 200) out.newChatModel = v.newChatModel
      if (v.enterSends === 'enter' || v.enterSends === 'mod') out.enterSends = v.enterSends
      if (v.timeStyle === 'relative' || v.timeStyle === 'exact') out.timeStyle = v.timeStyle
    }
  } catch { /* damaged value: use the defaults */ }
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "14:05" today, "Yesterday 14:05", "12 Nov, 14:05" this year, "12 Nov 2025" before that. Local time, 24-hour. */
export function exactTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const clock = `${pad(t.getHours())}:${pad(t.getMinutes())}`
  if (t.toDateString() === now.toDateString()) return clock
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (t.toDateString() === yesterday.toDateString()) return `Yesterday ${clock}`
  const day = `${t.getDate()} ${MONTHS[t.getMonth()]}`
  return t.getFullYear() === now.getFullYear() ? `${day}, ${clock}` : `${day} ${t.getFullYear()}`
}
