import { defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { $fetch } from 'ofetch'
import { useChats } from './useChats'
import { useCsrf } from './useCsrf'
import { useWorkspaces } from './useWorkspaces'
import { chatMenu, chatToMarkdown, exportFileName } from '../utils/chatMenu'
import type { ChatMenuChat } from '../utils/chatMenu'

const ModalRename = defineAsyncComponent(() => import('../components/ModalRename.vue'))
const ModalConfirm = defineAsyncComponent(() => import('../components/ModalConfirm.vue'))
const ModalShareChat = defineAsyncComponent(() => import('../components/chat/ModalShareChat.vue'))

export function useChatActions() {
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()
  const overlay = useOverlay()
  const { csrf, headerName } = useCsrf()
  const { updateChat, removeChat, fetchChats } = useChats()
  const { workspaces, linkChat, fetchWorkspaces, loaded: workspacesLoaded } = useWorkspaces()

  const renameModal = overlay.create(ModalRename)
  const deleteModal = overlay.create(ModalConfirm, {
    props: {
      title: 'Delete chat',
      description: 'Are you sure you want to delete this chat? This cannot be undone.',
      color: 'error'
    }
  })

  async function renameChat(id: string, currentTitle?: string | null): Promise<string | null> {
    const instance = renameModal.open({ title: currentTitle ?? '' })
    const result = await instance.result

    if (!result || result === currentTitle) return null

    try {
      await $fetch(`/api/chats/title/${id}`, {
        method: 'PATCH',
        headers: { [headerName]: csrf() },
        body: { title: result }
      })

      updateChat(id, { label: result })

      return result
    } catch {
      toast.add({
        description: 'Failed to rename chat',
        icon: 'i-lucide-alert-circle',
        color: 'error'
      })

      return null
    }
  }

  async function deleteChat(id: string): Promise<boolean> {
    const instance = deleteModal.open()
    const result = await instance.result

    if (!result) return false

    try {
      await $fetch(`/api/chats/${id}`, {
        method: 'DELETE',
        headers: { [headerName]: csrf() }
      })

      toast.add({
        title: 'Chat deleted',
        description: 'Your chat has been deleted',
        icon: 'i-lucide-trash'
      })

      removeChat(id)

      if ((route.params as { id?: string }).id === id) {
        router.push('/')
      }

      return true
    } catch {
      toast.add({
        description: 'Failed to delete chat',
        icon: 'i-lucide-alert-circle',
        color: 'error'
      })

      return false
    }
  }

  async function pinChat(id: string, pinned: boolean): Promise<boolean> {
    updateChat(id, { pinned })
    try {
      await $fetch(`/api/chats/pin/${id}`, { method: 'PATCH', headers: { [headerName]: csrf() }, body: { pinned } })
      return true
    } catch {
      updateChat(id, { pinned: !pinned })
      toast.add({ description: pinned ? 'Could not pin the chat' : 'Could not unpin the chat', icon: 'i-lucide-alert-circle', color: 'error' })
      return false
    }
  }

  /** Puts a chat in a workspace, moves it to another, or (null) takes it out. */
  async function moveChat(id: string, workspaceId: string | null): Promise<boolean> {
    const previous = useChats().chats.value.find(c => c.id === id)?.workspaceId
    try {
      await linkChat(id, { workspaceId })
      await fetchChats()
      const name = workspaces.value.find(w => w.id === workspaceId)?.name
      toast.add({ description: workspaceId ? `Moved to ${name ?? 'the workspace'}` : 'Removed from the workspace', icon: 'i-lucide-folder', actions: [{ label: 'Undo', color: 'neutral', variant: 'outline', onClick: () => { moveChat(id, previous ?? null) } }] })
      return true
    } catch {
      toast.add({ description: 'Could not move the chat', icon: 'i-lucide-alert-circle', color: 'error' })
      return false
    }
  }

  function shareChat(id: string, visibility: 'public' | 'private', onChange?: (v: 'public' | 'private') => void) {
    overlay.create(ModalShareChat, {
      props: {
        chatId: id,
        visibility,
        onChange: (v: 'public' | 'private') => { updateChat(id, { visibility: v }); onChange?.(v) }
      }
    }).open()
  }

  async function exportChat(id: string, title: string): Promise<boolean> {
    try {
      const chat = await $fetch<{ title?: string, messages: Array<{ role: string, parts?: Array<{ type?: string, text?: string }> }> }>(`/api/chats/${id}`)
      const text = chatToMarkdown(chat.title || title, chat.messages ?? [])
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = exportFileName(chat.title || title)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return true
    } catch {
      toast.add({ description: 'Could not export the chat', icon: 'i-lucide-alert-circle', color: 'error' })
      return false
    }
  }

  /**
   * The three-dot menu for one chat. It knows where the chat lives, so a chat in a workspace
   * offers Move and Remove, and one outside offers Add.
   */
  function menuFor(chat: ChatMenuChat & { label: string, visibility?: 'public' | 'private' }, after?: { onVisibility?: (v: 'public' | 'private') => void, onRenamed?: (title: string) => void }) {
    if (!workspacesLoaded.value) fetchWorkspaces()
    return chatMenu(chat, workspaces.value.map(w => ({ id: w.id, name: w.name })), {
      pin: pinned => { pinChat(chat.id, pinned) },
      share: () => shareChat(chat.id, chat.visibility ?? 'private', after?.onVisibility),
      rename: async () => { const t = await renameChat(chat.id, chat.label === 'Untitled' ? '' : chat.label); if (t) after?.onRenamed?.(t) },
      moveTo: (workspaceId) => { moveChat(chat.id, workspaceId) },
      removeFromWorkspace: () => { moveChat(chat.id, null) },
      exportChat: () => { exportChat(chat.id, chat.label) },
      remove: () => { deleteChat(chat.id) }
    })
  }

  return {
    renameChat,
    deleteChat,
    pinChat,
    moveChat,
    shareChat,
    exportChat,
    menuFor
  }
}
