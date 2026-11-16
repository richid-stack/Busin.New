import type { WorkspaceIconName } from '../types/workspaces'

/**
 * Written out in full so the icon bundle (scripts/build-icons.mjs) finds every name:
 * it reads literal names from the source and cannot see names built from pieces.
 */
export const WORKSPACE_ICONS: Record<WorkspaceIconName, string> = {
  'palette': 'i-lucide-palette',
  'store': 'i-lucide-store',
  'building-2': 'i-lucide-building-2',
  'music': 'i-lucide-music',
  'folder': 'i-lucide-folder',
  'briefcase': 'i-lucide-briefcase',
  'rocket': 'i-lucide-rocket',
  'book-open': 'i-lucide-book-open'
}

export const workspaceIcon = (name: string | undefined) => WORKSPACE_ICONS[name as WorkspaceIconName] ?? WORKSPACE_ICONS.folder

/** "2 minutes ago", "Yesterday", "Nov 12": the way the list says when a workspace was last used. */
export function whenUsed(iso: string, now = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24 && now.getDate() === then.getDate()) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

/** "48 KB" from a count of characters (text size, not file size: the workspace keeps only the text). */
export const sizeLabel = (chars: number) => chars < 1000 ? `${chars} chars` : `${Math.max(1, Math.round(chars / 1000))} KB`
