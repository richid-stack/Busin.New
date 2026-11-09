/** "2 min ago", "yesterday", or a date: short, for lists. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  if (s < 172_800) return 'yesterday'
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "1 min 20 s" between two moments. */
export function duration(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return ''
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  if (!Number.isFinite(s)) return ''
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}
