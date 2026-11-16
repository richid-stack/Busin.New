/** Whether the person (or their device) wants no movement. Mirrors the rules in main.css. */
export function motionReduced(): boolean {
  if (typeof window === 'undefined') return false
  const chosen = document.documentElement.dataset.motion
  if (chosen === 'reduced') return true
  if (chosen === 'full') return false
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const EASE_IN = 'cubic-bezier(0.55, 0, 0.8, 0.4)'
