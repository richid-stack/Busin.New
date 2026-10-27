/** "now", "5m", "3h", "2d", then a date: how X shows time. */
export function shortAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86_400) return `${Math.round(s / 3600)}h`
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d`
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) })
}

/** "Sep 2026", for when someone joined. */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''
}

export const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))
