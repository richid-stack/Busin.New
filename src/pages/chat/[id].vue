<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { $fetch } from 'ofetch'
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport, isReasoningUIPart, isToolUIPart, isTextUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { getSearchQuery } from '../../utils/tool'
import { compressImage } from '../../utils/image'
import { useModels } from '../../composables/useModels'
import { useChats } from '../../composables/useChats'
import { useCsrf } from '../../composables/useCsrf'
import { useRoute, useRouter } from 'vue-router'
import type { DropdownMenuItem } from '@nuxt/ui'
import ChatMessageContent from '../../components/chat/message/MessageContent.vue'
import ChatMessageActions from '../../components/chat/message/MessageActions.vue'
import ChatVisibility from '../../components/chat/ChatVisibility.vue'
import ChatTitle from '../../components/chat/ChatTitle.vue'
import ChatIndicator from '../../components/chat/Indicator.vue'
import TextSelectionToolbar from '../../components/chat/TextSelectionToolbar.vue'
import Navbar from '../../components/Navbar.vue'
import type { Vote } from '../../../server/utils/drizzle'

const route = useRoute<'/chat/[id]'>()
const toast = useToast()
const { model } = useModels()
const { fetchChats, chats } = useChats()
const { csrf, headerName } = useCsrf()

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
if (isOwner.value) {
  $fetch(`/api/chats/votes/${route.params.id}`).then((v) => {
    votes.value = v
  }).catch(() => {})
}

const router = useRouter()
const input = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const mcpItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: 'Upload Files',
      icon: 'i-lucide-paperclip',
      onSelect: () => {
        fileInput.value?.click()
      }
    },
    {
      label: 'Web Search (Agent)',
      icon: 'i-lucide-globe',
      onSelect: () => {
        input.value = 'Search the web for: '
      }
    }
  ],
  [
    {
      label: 'Connect Gmail',
      icon: 'i-logos-google-gmail',
      onSelect: () => {
        input.value = 'Connect my Gmail account and check for client inquiries'
        handleSubmit()
      }
    },
    {
      label: 'Connect Slack',
      icon: 'i-logos-slack-icon',
      onSelect: () => {
        input.value = 'Connect Slack workspace and alerts'
        handleSubmit()
      }
    },
    {
      label: 'Connect Google Drive',
      icon: 'i-logos-google-drive',
      onSelect: () => {
        input.value = 'Connect Google Drive and check shared folders'
        handleSubmit()
      }
    }
  ],
  [
    {
      label: 'Create Automated Workflow',
      icon: 'i-lucide-workflow',
      onSelect: () => {
        router.push('/workflows')
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
      fetchChats()
    }
  },
  onError(error) {
    let message = error.message
    if (typeof message === 'string' && message[0] === '{') {
      try {
        message = JSON.parse(message).message || message
      } catch {
        // keep original message on malformed JSON
      }
    }

    const isQuotaError = typeof message === 'string' && (
      message.includes('quota') ||
      message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('rate limit') ||
      message.includes('rate-limit') ||
      message.includes('Rate limit') ||
      message.includes('TPM') ||
      message.includes('tokens per minute') ||
      message.includes('429')
    )

    if (isQuotaError) {
      toast.add({
        title: 'Model Limit Reached',
        description: 'The selected model has reached its rate limit. Switched model to Gemini 3.5 Flash for you.',
        icon: 'i-lucide-zap',
        color: 'warning',
        duration: 8000
      })
      model.value = 'google/gemini-3.5-flash'
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

const attachments = ref<Array<{ file: File, url: string }>>([])

async function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) {
    const newAttachments = await Promise.all(
      Array.from(target.files).map(async (file) => {
        const compressed = await compressImage(file)
        return {
          file: compressed,
          url: compressed.type.startsWith('image/') ? URL.createObjectURL(compressed) : ''
        }
      })
    )
    attachments.value = [...attachments.value, ...newAttachments]
  }
  target.value = ''
}

function removeAttachment(index: number) {
  const attachment = attachments.value[index]
  if (attachment && attachment.url) {
    URL.revokeObjectURL(attachment.url)
  }
  attachments.value.splice(index, 1)
}

async function handleSubmit() {
  if (input.value.trim() || attachments.value.length > 0) {
    sendMessage({
      text: input.value,
      files: attachments.value.length > 0 ? attachments.value.map(a => a.file) : undefined
    })
    input.value = ''
    attachments.value.forEach(a => {
      if (a.url) URL.revokeObjectURL(a.url)
    })
    attachments.value = []
  }
}

const editingMessageId = ref<string | null>(null)

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
    onSubmit()
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
          :status="status"
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
              @regenerate="regenerateMessage"
              @vote="vote"
            />
          </template>
        </UChatMessages>

        <!-- Active Connections Context Pills -->
        <div v-if="isOwner" class="flex items-center gap-2 px-3 pb-2 pt-2 border-t border-default/50 bg-background/80 backdrop-blur-sm z-10 sticky bottom-[4.5rem]">
          <span class="text-xs font-medium text-muted uppercase tracking-wider mr-2">Context</span>
          <UBadge color="neutral" variant="subtle" size="sm" class="rounded-full shadow-sm flex items-center gap-1.5">
            <UIcon name="i-logos-google-gmail" class="size-3" />
            Connected
          </UBadge>
          <UBadge color="neutral" variant="subtle" size="sm" class="rounded-full shadow-sm flex items-center gap-1.5 opacity-50 hover:opacity-100 cursor-pointer transition-opacity">
            <UIcon name="i-logos-google-drive" class="size-3 grayscale" />
            Connect
          </UBadge>
        </div>

        <UChatPrompt
          v-if="isOwner"
          v-model="input"
          :error="error"
          :status="status === 'streaming' || status === 'submitted' ? 'streaming' : 'ready'"
          color="neutral"
          variant="subtle"
          class="sticky bottom-0 [view-transition-name:chat-prompt] rounded-b-none z-10 border-t border-default bg-background shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]"
          :ui="{ base: 'px-3 py-2', input: 'text-base' }"
          @submit="handleSubmit"
        >
          <template
            v-if="attachments.length > 0"
            #header
          >
            <div class="flex flex-wrap gap-2 px-4 pt-4 border-b border-default pb-2">
              <template
                v-for="(attachment, index) in attachments"
                :key="index"
              >
                <!-- Image Attachment -->
                <div
                  v-if="attachment.file.type.startsWith('image/')"
                  class="relative group"
                >
                  <img
                    :src="attachment.url"
                    class="size-16 object-cover rounded-xl border border-default shadow-sm"
                    alt="Attachment preview"
                  />
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="solid"
                    class="absolute -top-2 -right-2 !rounded-full !p-1 size-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-inverted text-inverted shadow-sm"
                    @click="removeAttachment(index)"
                  />
                </div>
                <!-- Non-Image Attachment -->
                <div
                  v-else
                  class="relative group flex items-center gap-2 bg-elevated border border-default rounded-md p-1.5 text-xs max-w-[12rem] pr-8 shadow-sm"
                >
                  <UIcon
                    v-if="attachment.file.type.includes('pdf')"
                    name="i-lucide-file-text"
                    class="size-4 shrink-0 text-muted"
                  />
                  <UIcon
                    v-else
                    name="i-lucide-file"
                    class="size-4 shrink-0 text-muted"
                  />
                  <span class="truncate">{{ attachment.file.name }}</span>
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    class="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity !p-1"
                    @click="removeAttachment(index)"
                  />
                </div>
              </template>
            </div>
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
                accept="image/*,application/pdf,text/plain,.doc,.docx"
                @change="handleFileSelect"
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
