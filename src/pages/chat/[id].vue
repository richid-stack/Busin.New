<script setup lang="ts">
import { ATTACH_ACCEPT } from '../../utils/attachmentTypes'
import { ref, computed, watch, onMounted } from 'vue'
import { $fetch } from 'ofetch'
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport, isReasoningUIPart, isToolUIPart, isTextUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { getSearchQuery } from '../../utils/tool'
import { useModels } from '../../composables/useModels'
import { useChats } from '../../composables/useChats'
import { useCsrf } from '../../composables/useCsrf'
import { useUserSession } from '../../composables/useUserSession'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { usePromptAttachments } from '../../composables/usePromptAttachments'
import PromptAttachments from '../../components/PromptAttachments.vue'
import { useRoute, useRouter } from 'vue-router'
import type { DropdownMenuItem } from '@nuxt/ui'
import ChatMessageContent from '../../components/chat/message/MessageContent.vue'
import ChatMessageActions from '../../components/chat/message/MessageActions.vue'
import ChatVisibility from '../../components/chat/ChatVisibility.vue'
import ChatTitle from '../../components/chat/ChatTitle.vue'
import ChatIndicator from '../../components/chat/Indicator.vue'
import TextSelectionToolbar from '../../components/chat/TextSelectionToolbar.vue'
import Navbar from '../../components/Navbar.vue'
export interface Vote {
  chatId: string
  messageId: string
  isUpvoted: boolean
}

const route = useRoute<'/chat/[id]'>()
const toast = useToast()
const { model } = useModels()
const DEFAULT_MODEL = 'google/gemini-3.5-flash'
const { fetchChats, chats, updateChat } = useChats()
const { csrf, headerName } = useCsrf()
const { loggedIn } = useUserSession()
const { openAuthModal } = useFirebaseAuth()
const { attachments, processing, onInputChange, remove: removeAttachment, clear: clearAttachments, toFileParts } = usePromptAttachments()

const data = await $fetch(`/api/chats/${route.params.id}`).catch(() => null)

const isOwner = computed(() => data?.isOwner ?? false)
const visibility = ref<'public' | 'private'>(data?.visibility ?? 'private')
const title = ref<string | null>(data?.title ?? null)

watch(() => chats.value.find(c => c.id === data?.id)?.label, (label) => {
  if (label && label !== 'Untitled') {
    title.value = label
  }
})

const votes = ref<Vote[]>([])
if (isOwner.value && data?.id) {
  $fetch(`/api/chats/votes/${data.id}`).then((v) => {
    votes.value = v
  }).catch(() => {})
}

const router = useRouter()
const input = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const mcpItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: 'Upload files',
      icon: 'i-lucide-paperclip',
      onSelect: () => {
        fileInput.value?.click()
      }
    },
    {
      label: 'Search the web',
      icon: 'i-lucide-globe',
      onSelect: () => {
        input.value = 'Search the web for: '
      }
    }
  ],
  [
    {
      label: 'Workflow Studio',
      icon: 'i-lucide-workflow',
      onSelect: () => {
        router.push('/workflows')
      }
    },
    {
      label: 'Integrations',
      icon: 'i-lucide-blocks',
      onSelect: () => {
        router.push('/integrations')
      }
    }
  ]
])

const { messages, status, error, sendMessage, regenerate, stop } = useChat({
  id: data?.id,
  messages: data?.messages,
  transport: new DefaultChatTransport({
    api: `/api/chats/${data?.id}`,
    fetch: async (url, options) => {
      let body = options?.body
      let headers: Record<string, string> = {
        ...options?.headers as Record<string, string>,
        [headerName]: csrf()
      }

      if (typeof body === 'string') {
        const reqBody = JSON.parse(body)
        body = JSON.stringify({
          ...reqBody,
          model: model.value
        })
      } else if (body instanceof FormData) {
        body.append('model', model.value)
      }

      return fetch(url, {
        ...options,
        headers,
        body
      })
    }
  }),
  onData: (dataPart) => {
    if (dataPart.type === 'data-chat-title') {
      const newTitle = (dataPart.data as any)?.title
      if (newTitle && newTitle !== 'Untitled') {
        title.value = newTitle
        if (data?.id) {
          updateChat(data.id, { label: newTitle })
        }
      }
      fetchChats()
    }
  },
  onError(error) {
    let message = error.message
    if (typeof message === 'string' && message[0] === '{') {
      try {
        const parsed = JSON.parse(message)
        message = parsed.statusMessage || parsed.message || message
      } catch {
        // keep original message on malformed JSON
      }
    }

    // Our own per-user throttle (HTTP 429 from the server): just ask them to wait.
    if (typeof message === 'string' && /too many requests/i.test(message)) {
      toast.add({
        title: 'Slow down a little',
        description: message,
        icon: 'i-lucide-timer',
        color: 'warning',
        duration: 8000
      })
      return
    }

    // The model provider's quota was reached: offer the default model instead.
    const isQuotaError = typeof message === 'string' && /quota|RESOURCE_EXHAUSTED|rate[ -]?limit|\bTPM\b|tokens per minute/i.test(message)

    if (isQuotaError && model.value !== DEFAULT_MODEL) {
      model.value = DEFAULT_MODEL
      toast.add({
        title: 'Model limit reached',
        description: 'That model hit its rate limit, so we switched to Gemini 3.5 Flash. Send your message again.',
        icon: 'i-lucide-zap',
        color: 'warning',
        duration: 8000
      })
    } else {
      toast.add({
        description: message,
        icon: 'i-lucide-alert-circle',
        color: 'error',
        duration: 8000
      })
    }
  }
})

const activeActivityText = computed(() => {
  if (status.value !== 'streaming') return 'Thinking...'

  const lastMsg = messages.value[messages.value.length - 1]
  if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.parts?.length) {
    return 'Thinking...'
  }

  const lastPart = lastMsg.parts[lastMsg.parts.length - 1]
  if (!lastPart) return 'Thinking...'
  if (isReasoningUIPart(lastPart)) {
    return 'Reasoning through problem...'
  }
  if (isToolUIPart(lastPart)) {
    const name = getToolName(lastPart)
    if (name === 'web_search' || name === 'google_search') {
      const q = getSearchQuery(lastPart)
      return q ? `Searching: ${q.slice(0, 28)}...` : 'Searching the web...'
    }
    if (name === 'plan') {
      return 'Formulating execution plan...'
    }
    if (name === 'calculator') {
      return 'Computing calculations...'
    }
    if (name === 'chart') {
      return 'Visualizing data...'
    }
    if (name === 'weather') {
      return 'Checking weather conditions...'
    }
    return `Executing ${name.replace(/_/g, ' ')}...`
  }
  if (isTextUIPart(lastPart)) {
    return 'Synthesizing response...'
  }

  return 'Thinking...'
})

async function handleSubmit() {
  if (processing.value) return
  if (!input.value.trim() && attachments.value.length === 0) return

  const files = attachments.value.length > 0 ? await toFileParts() : undefined
  sendMessage({ text: input.value, files })
  input.value = ''
  clearAttachments()
}

const editingMessageId = ref<string | null>(null)


function convertToWorkflow() {
  if (!loggedIn.value) {
    toast.add({ title: 'Sign in to build workflows', description: 'Workflows are tied to your account.', icon: 'i-lucide-lock', color: 'info' })
    openAuthModal()
    return
  }
  sendMessage({ text: "Please convert the automated tasks we just discussed into an automated workflow pipeline." })
}

function startEdit(message: UIMessage) {
  if (editingMessageId.value) return

  editingMessageId.value = message.id
}

function cancelEdit() {
  editingMessageId.value = null
}

async function saveEdit(message: UIMessage, text: string) {
  try {
    await $fetch(`/api/chats/messages/${data!.id}`, {
      method: 'DELETE',
      headers: { [headerName]: csrf() },
      body: { messageId: message.id, type: 'edit' }
    })
  } catch {
    toast.add({
      description: 'Failed to update message',
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })
    return
  }

  editingMessageId.value = null
  sendMessage({ text, messageId: message.id })
}

async function regenerateMessage(message: UIMessage) {
  try {
    await $fetch(`/api/chats/messages/${data!.id}`, {
      method: 'DELETE',
      headers: { [headerName]: csrf() },
      body: { messageId: message.id, type: 'regenerate' }
    })
  } catch {
    toast.add({
      description: 'Failed to regenerate message',
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })
    return
  }

  regenerate({ messageId: message.id })
}

function getVote(messageId: string) {
  const vote = votes.value.find(v => v.messageId === messageId)
  if (!vote) return null
  return !!vote.isUpvoted
}

async function vote(message: UIMessage, isUpvoted: boolean) {
  const snapshot = votes.value.map(v => ({ ...v }))
  const toggling = getVote(message.id) === isUpvoted
  const next = toggling ? null : isUpvoted

  votes.value = next === null
    ? votes.value.filter(v => v.messageId !== message.id)
    : [
        ...votes.value.filter(v => v.messageId !== message.id),
        { chatId: data!.id, messageId: message.id, isUpvoted: next }
      ]

  try {
    await $fetch(`/api/chats/votes/${data!.id}`, {
      method: 'POST',
      headers: { [headerName]: csrf() },
      body: next === null ? { messageId: message.id } : { messageId: message.id, isUpvoted: next }
    })
  } catch {
    votes.value = snapshot
    toast.add({
      description: 'Failed to save vote',
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })
  }
}

onMounted(() => {
  if (isOwner.value && data?.messages?.length === 1) {
    regenerate()
  }
})

function handleTextAction(action: string, selectedText: string) {
  let prompt = ''
  if (action === 'Quote:') {
    prompt = `> ${selectedText}\n\n`
  } else {
    prompt = `${action}\n\n> ${selectedText}\n\n`
  }
  input.value = prompt
  if (action !== 'Quote:') {
    handleSubmit()
  }
}
</script>

<template>
  <TextSelectionToolbar @action="handleTextAction" />
  
  <UDashboardPanel
    v-if="data?.id"
    id="chat"
    class="relative min-h-0 flex-1 h-full"
    :ui="{ body: 'p-0 sm:p-0 overscroll-none' }"
  >
    <template #header>
      <Navbar>
        <template #title>
          <ChatTitle
            :chat-id="data!.id"
            :title="title"
            :is-owner="isOwner"
            @update:title="title = $event"
          />
        </template>

        <ChatVisibility
          v-if="isOwner"
          :chat-id="data!.id"
          :visibility="visibility"
          @update:visibility="visibility = $event"
        />
      </Navbar>
    </template>

    <template #body>
      <UContainer class="flex-1 flex flex-col gap-4 sm:gap-6">
        <UChatMessages
          should-auto-scroll
          :messages="messages"
          :status="(status === 'streaming' && messages[messages.length - 1]?.role === 'user') ? 'submitted' : status"
          :spacing-offset="isOwner ? 200 : 0"
          class="pt-(--ui-header-height) pb-4 sm:pb-6"
        >
          <template #indicator>
            <div class="flex items-center gap-1.5">
              <ChatIndicator />

              <UChatShimmer
                :text="activeActivityText"
                class="text-sm"
              />
            </div>
          </template>

          <template #content="{ message }">
            <ChatMessageContent
              :message="message"
              :editing="isOwner && editingMessageId === message.id"
              @save="saveEdit"
              @cancel-edit="cancelEdit"
            />
          </template>

          <template
            v-if="isOwner"
            #actions="{ message }"
          >
            <ChatMessageActions
              :message="message"
              :streaming="status === 'streaming' && message.id === messages[messages.length - 1]?.id"
              :editing="editingMessageId === message.id"
              :vote="getVote(message.id)"
              @edit="startEdit"
              @convertToWorkflow="convertToWorkflow"
              @regenerate="regenerateMessage"
              @vote="vote"
            />
          </template>
        </UChatMessages>

        <UChatPrompt
          v-if="isOwner"
          v-model="input"
          :error="error"
          color="neutral"
          variant="subtle"
          class="sticky bottom-0 [view-transition-name:chat-prompt] rounded-b-none z-10 border-t border-default shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]"
          :ui="{ base: 'px-3 py-2' }"
          @submit="handleSubmit"
        >
          <template #header>
            <PromptAttachments
              :attachments="attachments"
              @remove="removeAttachment"
            />
          </template>

          <template #footer>
            <div class="flex items-center gap-2 pt-1">
              <UDropdownMenu
                :items="mcpItems"
                :content="{ align: 'start', side: 'top', collisionPadding: 12 }"
              >
                <UButton
                  id="chat-attach-btn"
                  icon="i-lucide-plus"
                  class="rounded-full shrink-0 cursor-pointer transition-transform hover:rotate-90 shadow-sm"
                  variant="soft"
                  color="primary"
                  size="sm"
                  aria-label="Capabilities & Integrations"
                  title="Capabilities & Integrations"
                />
              </UDropdownMenu>
              <input
                ref="fileInput"
                type="file"
                multiple
                class="hidden"
                :accept="ATTACH_ACCEPT"
                @change="onInputChange"
              >
              <ModelSelect v-model="model" />
            </div>

            <UChatPromptSubmit
              :status="status"
              color="primary"
              size="sm"
              class="rounded-full"
              @stop="stop()"
              @reload="regenerate()"
            />
          </template>
        </UChatPrompt>
      </UContainer>
    </template>
  </UDashboardPanel>

  <UContainer
    v-else
    class="flex-1 flex flex-col gap-4 sm:gap-6"
  >
    <UError
      :error="{ statusMessage: 'Chat not found', statusCode: 404 }"
      class="min-h-full"
    >
      <template #links>
        <UButton
          to="/"
          size="lg"
          label="Back to home"
        />
      </template>
    </UError>
  </UContainer>
</template>
