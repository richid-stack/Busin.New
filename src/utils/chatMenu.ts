import type { DropdownMenuItem } from '@nuxt/ui'

export interface ChatMenuChat {
  id: string
  pinned?: boolean
  workspaceId?: string | null
}

export interface ChatMenuWorkspace { id: string, name: string }

export interface ChatMenuHandlers {
  pin: (pinned: boolean) => void
  share: () => void
  rename: () => void
  moveTo: (workspaceId: string) => void
  removeFromWorkspace: () => void
  exportChat: () => void
  remove: () => void
}

/**
 * What the three dots on a chat offer. The list depends on where the chat lives:
 * a chat in no workspace can be added to one; a chat already in one can move to another or leave, and is never "added".
 */
export function chatMenu(chat: ChatMenuChat, workspaces: ChatMenuWorkspace[], h: ChatMenuHandlers): DropdownMenuItem[][] {
  const inWorkspace = Boolean(chat.workspaceId)
  const others = workspaces.filter(w => w.id !== chat.workspaceId)

  const main: DropdownMenuItem[] = [
    { label: chat.pinned ? 'Unpin' : 'Pin', icon: chat.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin', onSelect: () => h.pin(!chat.pinned) },
    { label: 'Share', icon: 'i-lucide-share', onSelect: () => h.share() },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => h.rename() }
  ]

  if (others.length) {
    main.push({
      label: inWorkspace ? 'Move to workspace' : 'Add to workspace',
      icon: inWorkspace ? 'i-lucide-folder-input' : 'i-lucide-folder-plus',
      children: others.map(w => ({ label: w.name, icon: 'i-lucide-folder', onSelect: () => h.moveTo(w.id) }))
    })
  }
  if (inWorkspace) {
    main.push({ label: 'Remove from workspace', icon: 'i-lucide-folder-minus', onSelect: () => h.removeFromWorkspace() })
  }
  main.push({ label: 'Export', icon: 'i-lucide-download', onSelect: () => h.exportChat() })

  return [main, [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => h.remove() }]]
}

/** A chat as a Markdown file: who said what, in order. Tool calls and files are left out; only the words. */
export function chatToMarkdown(title: string, messages: Array<{ role: string, parts?: Array<{ type?: string, text?: string }> }>): string {
  const blocks = messages.map((m) => {
    const text = (m.parts ?? []).filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text!.trim()).filter(Boolean).join('\n\n')
    return text ? `**${m.role === 'user' ? 'You' : 'OpenLobs'}**\n\n${text}` : ''
  }).filter(Boolean)
  return `# ${title || 'Chat'}\n\n${blocks.join('\n\n---\n\n')}\n`
}

/** A safe file name from a chat title. */
export function exportFileName(title: string): string {
  const base = (title || 'chat').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${base || 'chat'}.md`
}
