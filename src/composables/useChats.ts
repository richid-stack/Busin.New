import { isToday, isYesterday, subDays, subMonths } from 'date-fns'
import { computed, ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'

interface ChatData {
  id: string
  title?: string | null
  workspaceId?: string | null
  pinned?: boolean
  visibility?: 'public' | 'private'
  createdAt: string | number | Date
}

interface Chat {
  id: string
  label: string
  to: string
  icon: string
  workspaceId?: string
  pinned?: boolean
  visibility: 'public' | 'private'
  createdAt: string
}

export const useChats = createSharedComposable(() => {
  const chats = ref<Chat[]>([])

  const fetchChats = async () => {
    chats.value = await $fetch('/api/chats').then((data: ChatData[]) => data.map(chat => ({
      id: chat.id,
      label: chat.title || 'Untitled',
      to: `/chat/${chat.id}`,
      icon: 'i-lucide-message-circle',
      ...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
      ...(chat.pinned ? { pinned: true } : {}),
      visibility: chat.visibility === 'public' ? 'public' : 'private',
      createdAt: String(chat.createdAt)
    }) as Chat)).catch(error => {
      console.error(error)
      return []
    })
  }

  const updateChat = (id: string, partial: Partial<Chat>) => {
    chats.value = chats.value.map(c => c.id === id ? { ...c, ...partial } : c)
  }

  const removeChat = (id: string) => {
    chats.value = chats.value.filter(c => c.id !== id)
  }

  const groups = computed(() => {
    // Group chats by date
    const today: Chat[] = []
    const yesterday: Chat[] = []
    const lastWeek: Chat[] = []
    const lastMonth: Chat[] = []
    const older: Record<string, Chat[]> = {}

    const oneWeekAgo = subDays(new Date(), 7)
    const oneMonthAgo = subMonths(new Date(), 1)

    // A chat inside a workspace lives on that workspace's page, so it does not crowd the history here.
    const newestFirst = [...(chats.value ?? []).filter(c => !c.workspaceId && !c.pinned)].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    newestFirst.forEach((chat) => {
      const chatDate = new Date(chat.createdAt)

      if (isToday(chatDate)) {
        today.push(chat)
      } else if (isYesterday(chatDate)) {
        yesterday.push(chat)
      } else if (chatDate >= oneWeekAgo) {
        lastWeek.push(chat)
      } else if (chatDate >= oneMonthAgo) {
        lastMonth.push(chat)
      } else {
        // Format: "January 2023", "February 2023", etc.
        const monthYear = chatDate.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric'
        })

        if (!older[monthYear]) {
          older[monthYear] = []
        }

        older[monthYear].push(chat)
      }
    })

    // Sort older chats by month-year in descending order (newest first)
    const sortedMonthYears = Object.keys(older).sort((a, b) => {
      const dateA = new Date(a)
      const dateB = new Date(b)
      return dateB.getTime() - dateA.getTime()
    })

    // Create formatted groups for navigation
    const formattedGroups = [] as Array<{
      id: string
      label: string
      items: Array<Chat>
    }>

    // Add groups that have chats
    if (today.length) {
      formattedGroups.push({
        id: 'today',
        label: 'Today',
        items: today
      })
    }

    if (yesterday.length) {
      formattedGroups.push({
        id: 'yesterday',
        label: 'Yesterday',
        items: yesterday
      })
    }

    if (lastWeek.length) {
      formattedGroups.push({
        id: 'last-week',
        label: 'Last week',
        items: lastWeek
      })
    }

    if (lastMonth.length) {
      formattedGroups.push({
        id: 'last-month',
        label: 'Last month',
        items: lastMonth
      })
    }

    // Add each month-year group
    sortedMonthYears.forEach((monthYear) => {
      if (older[monthYear]?.length) {
        formattedGroups.push({
          id: monthYear,
          label: monthYear,
          items: older[monthYear]
        })
      }
    })

    return formattedGroups
  })

  /** Chats the person pinned (outside workspaces), newest first. A pinned chat in a workspace stays on that workspace's page. */
  const pinnedChats = computed(() => [...(chats.value ?? []).filter(c => c.pinned && !c.workspaceId)].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))

  /** Chats that belong to a workspace; still found by search. */
  const workspaceChats = computed(() => (chats.value ?? []).filter(c => c.workspaceId))

  return {
    groups,
    pinnedChats,
    workspaceChats,
    chats,
    fetchChats,
    updateChat,
    removeChat
  }
})
