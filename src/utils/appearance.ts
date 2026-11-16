export const ACCENTS = [
  { value: 'blue', label: 'Blue', swatch: 'bg-blue-500' },
  { value: 'violet', label: 'Violet', swatch: 'bg-violet-500' },
  { value: 'emerald', label: 'Green', swatch: 'bg-emerald-500' },
  { value: 'orange', label: 'Orange', swatch: 'bg-orange-500' },
  { value: 'rose', label: 'Rose', swatch: 'bg-rose-500' },
  { value: 'ink', label: 'Ink', swatch: 'bg-neutral-800 dark:bg-neutral-200' }
] as const

export type Accent = typeof ACCENTS[number]['value']
export type TextSize = 'small' | 'default' | 'large'
export type ChatWidth = 'narrow' | 'standard' | 'wide'
export type MotionChoice = 'system' | 'full' | 'reduced'

export interface Appearance { accent: Accent, text: TextSize, width: ChatWidth, motion: MotionChoice }

export const DEFAULT_APPEARANCE: Appearance = { accent: 'blue', text: 'default', width: 'standard', motion: 'system' }

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(String(value)) ? value as T : fallback

/** Whatever was saved, made safe: anything unknown goes back to the default for that one setting. */
export function parseAppearance(raw: unknown): Appearance {
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) ?? {} } catch { obj = {} }
  } else if (raw && typeof raw === 'object') obj = raw as Record<string, unknown>
  return {
    accent: pick(obj.accent, ACCENTS.map(a => a.value), DEFAULT_APPEARANCE.accent),
    text: pick(obj.text, ['small', 'default', 'large'] as const, DEFAULT_APPEARANCE.text),
    width: pick(obj.width, ['narrow', 'standard', 'wide'] as const, DEFAULT_APPEARANCE.width),
    motion: pick(obj.motion, ['system', 'full', 'reduced'] as const, DEFAULT_APPEARANCE.motion)
  }
}

/** The attributes put on <html>. A default leaves the attribute off, so the stylesheet's own look applies. */
export function appearanceAttributes(a: Appearance): Record<string, string | null> {
  return {
    'data-accent': a.accent === 'blue' ? null : a.accent,
    'data-text': a.text === 'default' ? null : a.text,
    'data-width': a.width === 'standard' ? null : a.width,
    'data-motion': a.motion === 'system' ? null : a.motion
  }
}
