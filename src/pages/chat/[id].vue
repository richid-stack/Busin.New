<script setup lang="ts">
import { ATTACH_ACCEPT } from '../../utils/attachmentTypes'
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount, provide } from 'vue'
import { $fetch } from 'ofetch'
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport, isReasoningUIPart, isToolUIPart, isTextUIPart, getToolName, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import type { UIMessage } from 'ai'
import { getSearchQuery } from '../../utils/tool'
import { useModels } from '../../composables/useModels'
import { usePreferences } from '../../composables/usePreferences'
import { useAgents } from '../../composables/useAgents'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { useSkills } from '../../composables/useSkills'
import { usePlusMenu } from '../../composables/usePlusMenu'
import PlusMenu from '../../components/PlusMenu.vue'
import { useChats } from '../../composables/useChats'
import { useCsrf } from '../../composables/useCsrf'
import { useUserSession } from '../../composables/useUserSession'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { usePromptAttachments } from '../../composables/usePromptAttachments'
import PromptAttachments from '../../components/PromptAttachments.vue'
import { useRoute, useRouter } from 'vue-router'
import ChatMessageContent from '../../components/chat/message/MessageContent.vue'
import Person from '../../components/agents/Person.vue'
import Creature from '../../components/agents/Creature.vue'
import { mascotFor } from '../../../shared/mascots'
import { specialistLanes } from '../../utils/specialistLanes'
import ChatMessageActions from '../../components/chat/message/MessageActions.vue'
import { useChatActions } from '../../composables/useChatActions'
import ChatTitle from '../../components/chat/ChatTitle.vue'
import PromptWaves from '../../components/lobby/PromptWaves.vue'
import DictateButton from '../../components/lobby/DictateButton.vue'
import PromptVoiceButton from '../../components/lobby/PromptVoiceButton.vue'
import { useLobby } from '../../composables/useLobby'
import { useDictation } from '../../composables/useDictation'
import ChatIndicator from '../../components/chat/Indicator.vue'
import TextSelectionToolbar from '../../components/chat/TextSelectionToolbar.vue'
import Navbar from '../../components/Navbar.vue'
import WorkPane from '../../components/work/WorkPane.vue'
import { useWorkPane } from '../../composables/useWorkPane'
export interface Vote {
  chatId: string
  messageId: string
  isUpvoted: boolean
}

const route = useRoute<'/chat/[id]'>()
const toast = useToast()
const { model } = useModels()
const { prefs } = usePreferences()
const { getAgent, loaded: agentsLoaded, fetchAgents } = useAgents()
const DEFAULT_MODEL = 'google/gemini-3.5-flash'
const { fetchChats, chats, updateChat } = useChats()
const { csrf, headerName } = useCsrf()
const { loggedIn } = useUserSession()
const { openAuthModal } = useFirebaseAuth()
const workPane = useWorkPane()
const { attachments, processing, onInputChange, remove: removeAttachment, clear: clearAttachments, toFileParts } = usePromptAttachments()

const data = await $fetch(`/api/chats/${route.params.id}`).catch(() => null)

const isOwner = computed(() => data?.isOwner ?? false)
// The saved agent this chat talks to (only the owner sees it; it may have been deleted since).
const agentId = ref<string | null>(data?.agentId ?? null)
const workspaceId = ref<string | null>(data?.workspaceId ?? null)
const agent = computed(() => (isOwner.value ? getAgent(agentId.value) : undefined))
const { loaded: workspacesLoaded, fetchWorkspaces, getWorkspace, linkChat, messageOf } = useWorkspaces()
const { loaded: skillsLoaded, fetchSkills } = useSkills()
const workspace = computed(() => (isOwner.value ? getWorkspace(workspaceId.value) : undefined))
onMounted(() => {
  if (!isOwner.value) return
  if (!agentsLoaded.value) fetchAgents()
  if (!workspacesLoaded.value) fetchWorkspaces()
  if (!skillsLoaded.value) fetchSkills()
})

/** Moves this chat into a workspace (or out) or switches its agent. The server checks both belong to this person. */
async function relink(link: { workspaceId?: string | null, agentId?: string | null }) {
  try {
    const res = await linkChat(data!.id, link)
    workspaceId.value = res.workspaceId
    agentId.value = res.agentId
    fetchChats()
  } catch (err: any) {
    toast.add({ title: 'Could not change that', description: messageOf(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}
const visibility = ref<'public' | 'private'>(data?.visibility ?? 'private')
const isGhost = computed(() => Boolean((data as any)?.ghost))
const { menuFor } = useChatActions()
// The chat list is the one source for where this chat lives and whether it is pinned, so the sidebar and this menu agree.
const listed = computed(() => chats.value.find(c => c.id === data?.id))
watch(() => listed.value?.workspaceId ?? null, (id) => { workspaceId.value = id })
const chatMenuItems = computed(() => menuFor({
  id: data!.id,
  label: title.value || 'Untitled',
  pinned: Boolean(listed.value?.pinned),
  workspaceId: workspaceId.value,
  visibility: visibility.value
}, {
  onVisibility: (v) => { visibility.value = v },
  onRenamed: (t) => { title.value = t }
}))

// Ghost mode: the chat goes when the person leaves. A closed tab is caught on the server by a sweep.
function dropGhost() {
  if (!isGhost.value || !isOwner.value || !data?.id) return
  fetch(`/api/chats/${data.id}`, { method: 'DELETE', keepalive: true, headers: { [headerName]: csrf() } }).catch(() => {})
}
if (isGhost.value) {
  onMounted(() => window.addEventListener('pagehide', dropGhost))
  onBeforeUnmount(() => { window.removeEventListener('pagehide', dropGhost); dropGhost() })
}
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

const plus = usePlusMenu({
  input,
  chooseFile: () => fileInput.value?.click(),
  workspaceId,
  agentId,
  pickWorkspace: id => relink({ workspaceId: id }),
  pickAgent: id => relink({ agentId: id })
})

// While Lobby is on the stage the assistant is told to talk the way it should be heard: short, narrating as it works.
const voiceMode = ref(false)

const { messages, status, error, sendMessage, regenerate, stop, addToolApprovalResponse } = useChat({
  id: data?.id,
  messages: data?.messages,
  // Once every question the assistant asked has an answer, the conversation carries on by itself.
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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
          model: model.value,
          voice: voiceMode.value || undefined,
          workPane: workPane.forChat.value
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

    // Plan limit reached: the server's message already says which limit and when it resets.
    if (typeof message === 'string' && /used your (daily|monthly) limit/i.test(message)) {
      toast.add({
        title: 'Credit limit reached',
        description: message,
        icon: 'i-lucide-gauge',
        color: 'warning',
        duration: 12000
      })
      return
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

const lobby = reactive(useLobby({
  messages,
  status,
  send: text => sendMessage({ text }),
  stop: () => stop(),
  respond: (id, approved) => addToolApprovalResponse({ id, approved })
}))
watch(() => lobby.open, (on) => { voiceMode.value = on })

// A file made or changed in this chat: when the assistant finishes, the open file shows its new version.
// A change the assistant just made opens the file beside the chat so the result is right there.
watch(status, (now, before) => {
  if (now !== 'ready' || (before !== 'streaming' && before !== 'submitted')) return
  const last = messages.value[messages.value.length - 1]
  const edited = last?.role === 'assistant'
    ? last.parts.filter(p => isToolUIPart(p) && ['edit_file', 'write_file', 'edit_project_file', 'delete_file'].includes(getToolName(p))).map(p => (p as any).output).filter(o => o?.status === 'ok' && o.artifactId).pop()
    : undefined
  if (edited && workPane.openId.value !== edited.artifactId) void workPane.open(edited.artifactId)
  else if (workPane.openId.value) void workPane.refresh()
})
// While a project is being built, files appear beside the chat as each step finishes.
const PROJECT_STEPS = ['write_file', 'edit_project_file', 'delete_file']
const projectProgress = computed(() => {
  const last = messages.value[messages.value.length - 1]
  if (last?.role !== 'assistant') return { count: 0, id: undefined as string | undefined }
  const done = last.parts.filter(p => isToolUIPart(p) && PROJECT_STEPS.includes(getToolName(p)) && (p as any).output?.status === 'ok' && (p as any).output.artifactId)
  return { count: done.length, id: (done[done.length - 1] as any)?.output.artifactId as string | undefined }
})
watch(() => projectProgress.value.count, (count, was) => {
  const id = projectProgress.value.id
  if (!count || count === was || !id) return
  if (workPane.openId.value !== id) void workPane.open(id)
  else void workPane.refresh()
})
const paneOpen = computed(() => !!workPane.openId.value)
const working = computed(() => status.value === 'streaming' || status.value === 'submitted')
function changeFromPane(text: string) { sendMessage({ text }) }
watch(() => route.params.id, () => workPane.close())
onBeforeUnmount(() => workPane.close())

// The approval cards in the messages answer through this.
provide('respondToToolApproval', (id: string, approved: boolean) => addToolApprovalResponse({ id, approved }))

// Who OpenLobs has handed the job to right now, so the header says plainly when a specialist is working.
const workingSpecialist = computed(() => {
  if (status.value !== 'streaming' && status.value !== 'submitted') return null
  const last = messages.value[messages.value.length - 1]
  return last?.role === 'assistant' ? specialistLanes(last.parts ?? []).active : null
})

const activeActivityText = computed(() => {
  const who = workingSpecialist.value
  if (status.value === 'streaming' && who) return `${who.name} is working...`
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

const hasInput = computed(() => input.value.trim() !== '' || attachments.value.length > 0)
const dictation = useDictation(input)
// With nothing typed, the waveform sits where Send does and the small mic beside it dictates into the box.
const showVoiceButton = computed(() => !hasInput.value && status.value === 'ready')
const showDictate = computed(() => dictation.supported.value && (dictation.listening.value || dictation.working.value || showVoiceButton.value))
// Typing while Lobby listens would send the room's noise as a message, so listening waits until the person is done.
watch(hasInput, (typing) => { if (typing && lobby.open) lobby.pause() })

async function handleSubmit() {
  if (processing.value) return
  if (!input.value.trim() && attachments.value.length === 0) return
  if (lobby.open) lobby.silence()

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
  // "Talk to Lobby" on the home page lands here with the stage already open.
  if (isOwner.value && route.query.lobby === '1') {
    router.replace({ path: route.path })
    void lobby.show()
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
          <nav
            class="flex min-w-0 items-center gap-2 text-sm"
            aria-label="Breadcrumb"
          >
            <template v-if="workspace">
              <RouterLink
                :to="`/workspaces/${workspace.id}`"
                class="max-w-48 truncate text-muted hover:text-default"
              >
                {{ workspace.name }}
              </RouterLink>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-3.5 shrink-0 text-dimmed"
              />
            </template>
            <ChatTitle
              :chat-id="data!.id"
              :title="title"
              :is-owner="isOwner"
              @update:title="title = $event"
            />
            <span
              v-if="agent"
              class="ml-1 hidden max-w-44 items-center gap-1.5 rounded-md bg-elevated px-1.5 py-0.5 text-xs font-medium text-highlighted ring-1 ring-inset ring-default sm:inline-flex"
              :title="`This chat is with your agent ${agent.name}`"
            >
              <Person
                :id="mascotFor(agent)"
                :size="20"
              />
              <span class="truncate">{{ agent.name }}</span>
            </span>
            <span
              v-if="workingSpecialist"
              class="ml-1 inline-flex max-w-52 items-center gap-1.5 rounded-md bg-elevated px-1.5 py-0.5 text-xs font-medium text-highlighted ring-1 ring-inset ring-default"
              :title="`OpenLobs is using its specialist ${workingSpecialist.name}, the ${workingSpecialist.role}`"
              role="status"
            >
              <Creature
                :species="workingSpecialist.id"
                mood="working"
                :size="20"
                animate
              />
              <span class="truncate">{{ workingSpecialist.name }} is working</span>
            </span>
          </nav>
        </template>

        <span
          v-if="isGhost"
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted ring-1 ring-inset ring-default"
          title="Not saved and not remembered. Deleted when you leave."
        >
          <UIcon
            name="i-lucide-ghost"
            class="size-3.5"
          />
          Ghost mode
        </span>
        <UDropdownMenu
          v-else-if="isOwner"
          :items="chatMenuItems"
          :content="{ align: 'end', side: 'bottom' }"
          :ui="{ content: 'w-56' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis"
            aria-label="Chat options"
          />
        </UDropdownMenu>
      </Navbar>
    </template>

    <template #body>
      <UContainer class="chat-width flex-1 flex flex-col gap-4 sm:gap-6">
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
              :chat-id="data!.id"
              :live="isOwner && message.id === messages[messages.length - 1]?.id"
              :working="status === 'streaming' || status === 'submitted'"
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
              @convert-to-workflow="convertToWorkflow"
              @regenerate="regenerateMessage"
              @vote="vote"
            />
          </template>
        </UChatMessages>

        <UChatPrompt
          v-if="isOwner"
          v-model="input"
          :submit-on-enter="prefs.enterSends === 'enter'"
          :error="error"
          color="primary"
          variant="subtle"
          class="soft-focus sticky bottom-0 [view-transition-name:chat-prompt] rounded-b-none z-10 border-t border-default shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]"
          :ui="{ base: 'px-3 py-2', body: lobby.open ? 'hidden' : '' }"
          @submit="handleSubmit"
        >
          <template #header>
            <PromptWaves
              v-if="lobby.open"
              :lobby="lobby"
            />
            <PromptAttachments
              :attachments="attachments"
              @remove="removeAttachment"
            />
          </template>

          <template #footer>
            <div class="flex items-center gap-2 pt-1">
              <PlusMenu
                id="chat-attach-btn"
                :items="plus.items.value"
                :active="plus.active.value"
              />
              <input
                ref="fileInput"
                type="file"
                multiple
                class="hidden"
                :accept="ATTACH_ACCEPT"
                @change="onInputChange"
              >
              <ModelSelect
                v-if="!agent?.model"
                v-model="model"
              />
            </div>

            <div class="flex items-center gap-1.5">
              <!-- Voice mode: the box above is the waveform; these are mute, end, and the one tap that does the obvious thing. -->
              <template v-if="lobby.open">
                <UButton
                  :icon="lobby.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="rounded-full"
                  :aria-label="lobby.muted ? 'Turn Lobby’s voice on' : 'Mute Lobby’s voice'"
                  @click="lobby.toggleMute()"
                />
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="rounded-full"
                  aria-label="Stop talking to Lobby"
                  @click="lobby.hide()"
                />
                <PromptVoiceButton
                  :state="lobby.state"
                  :level="lobby.level"
                  @press="lobby.tap()"
                />
              </template>
              <template v-else>
                <DictateButton
                  v-if="showDictate"
                  :listening="dictation.listening.value"
                  :working="dictation.working.value"
                  @press="dictation.toggle()"
                />
                <!-- With nothing typed the waveform is where Send is; as soon as there is text it becomes Send. -->
                <PromptVoiceButton
                  v-if="showVoiceButton"
                  @press="lobby.show()"
                />
                <UChatPromptSubmit
                  v-else
                  :status="status"
                  color="primary"
                  size="sm"
                  class="rounded-full"
                  @stop="stop()"
                  @reload="regenerate()"
                />
              </template>
            </div>
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

  <div
    v-if="data?.id && paneOpen && isOwner"
    class="fixed inset-0 z-40 md:static md:z-auto md:h-full md:w-[48%] md:max-w-[760px] md:shrink-0"
  >
    <WorkPane
      :busy="working"
      @send="changeFromPane"
    />
  </div>
</template>
