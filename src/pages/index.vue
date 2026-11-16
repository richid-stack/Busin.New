<script setup lang="ts">
import { vGrow } from '../directives/grow'
import { ATTACH_ACCEPT } from '../utils/attachmentTypes'
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { $fetch } from 'ofetch'
import { useChats } from '../composables/useChats'
import { useCsrf } from '../composables/useCsrf'
import { useUserSession } from '../composables/useUserSession'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { usePromptAttachments } from '../composables/usePromptAttachments'
import Navbar from '../components/Navbar.vue'
import PromptAttachments from '../components/PromptAttachments.vue'
import PromptVoiceButton from '../components/lobby/PromptVoiceButton.vue'
import DictateButton from '../components/lobby/DictateButton.vue'
import { useDictation } from '../composables/useDictation'
import PlusMenu from '../components/PlusMenu.vue'
import { useAgents } from '../composables/useAgents'
import { useWorkspaces } from '../composables/useWorkspaces'
import { useSkills } from '../composables/useSkills'
import { usePlusMenu } from '../composables/usePlusMenu'
import GuestReply from '../components/chat/GuestReply.vue'
import { savePendingPrompt, takePendingPrompt } from '../utils/guestReply'
import { suggestAgent } from '../utils/agentSuggest'

const toast = useToast()
const { fetchChats } = useChats()
const { csrf, headerName } = useCsrf()
const { user, loggedIn, fetchSession } = useUserSession()
const { openAuthModal, authReady, isAuthenticated } = useFirebaseAuth()
const { attachments, processing, onInputChange, remove, clear, toApiAttachments } = usePromptAttachments()

const input = ref('')
// Ghost mode: this chat is not saved in the history, not added to memory, and goes when you leave.
const ghost = ref(false)
const loading = ref(false)
const dictation = useDictation(input)

const router = useRouter()
const route = useRoute()
/** The saved agent the new chat starts with; null is the standard assistant. */
const agentId = ref<string | null>(null)
const { agents, loaded: agentsLoaded, fetchAgents } = useAgents()
const selectedAgent = computed(() => agents.value.find(a => a.id === agentId.value))
// A link from the Agents page (?agent=...) preselects it, but only if it is one of the user's agents.
watch([agentsLoaded, () => route.query.agent], () => {
  const wanted = route.query.agent
  if (typeof wanted === 'string' && agentsLoaded.value && agents.value.some(a => a.id === wanted)) agentId.value = wanted
}, { immediate: true })
// A free, local hint: when what is being typed clearly fits one of the person's agents, offer it. They choose.
const dismissedHint = ref<string | null>(null)
const agentHint = computed(() => {
  if (agentId.value || !agents.value.length || input.value.trim().length < 15) return null
  const found = suggestAgent(input.value, agents.value)
  return found && found.agent.id !== dismissedHint.value ? found.agent : null
})
const fileInput = ref<HTMLInputElement | null>(null)

/** The workspace the new chat starts in; null is none. A link from a workspace (?workspace=...) preselects it. */
const workspaceId = ref<string | null>(null)
const { workspaces, loaded: workspacesLoaded, fetchWorkspaces, getWorkspace } = useWorkspaces()
const { loaded: skillsLoaded, fetchSkills } = useSkills()
watch([workspacesLoaded, () => route.query.workspace], () => {
  const wanted = route.query.workspace
  if (typeof wanted === 'string' && workspacesLoaded.value && workspaces.value.some(w => w.id === wanted)) workspaceId.value = wanted
}, { immediate: true })
function pickWorkspace(id: string | null) {
  workspaceId.value = id
  // A workspace brings its own agent, unless one was already picked for this chat.
  const own = getWorkspace(id)?.agentId
  if (own && !agentId.value) agentId.value = own
}
const plus = usePlusMenu({ input, chooseFile: () => fileInput.value?.click(), workspaceId, agentId, pickWorkspace, pickAgent: (id) => { agentId.value = id } })

const greeting = computed(() => {
  const hour = new Date().getHours()
  let timeGreeting = 'Good evening'
  if (hour < 12) timeGreeting = 'Good morning'
  else if (hour < 18) timeGreeting = 'Good afternoon'

  const name = user.value?.name?.split(' ')[0] || user.value?.username

  return name ? `${timeGreeting}, ${name}` : `${timeGreeting}`
})

/** What a signed-out visitor just typed; shown with OpenLobs' invitation to sign in. */
const guestMessage = ref<string | null>(null)

/** Signed in for real: Firebase knows the user and the server session agrees. */
async function ensureSignedIn(): Promise<boolean> {
  if (!authReady.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(authReady, (ready) => {
        if (ready) {
          stop()
          resolve()
        }
      }, { immediate: true })
    })
  }
  if (!isAuthenticated.value) return false
  if (!loggedIn.value) await fetchSession()
  return loggedIn.value
}

// Once the visitor signs in, send what they had typed.
// Agents are the signed-in person's own, so load them once the server session exists (also when someone signs in on this page).
watch(loggedIn, (signedIn) => {
  if (!signedIn) return
  fetchAgents()
  if (!workspacesLoaded.value) fetchWorkspaces()
  if (!skillsLoaded.value) fetchSkills()
}, { immediate: true })

watch(loggedIn, (signedIn) => {
  if (!signedIn) return
  const pending = takePendingPrompt()
  guestMessage.value = null
  if (pending) createChat(pending)
})

// Deep links like /?prompt=... (from integration pages) prefill the box without sending it.
onMounted(() => {
  if (loggedIn.value) {
    const pending = takePendingPrompt()
    if (pending) createChat(pending)
  }
  const prefill = route.query.prompt
  if (typeof prefill === 'string' && prefill.trim()) {
    input.value = prefill.slice(0, 2000)
    router.replace({ path: '/' })
  }
})

async function createChat(prompt: string) {
  if (loading.value || processing.value) return
  if (!prompt.trim() && attachments.value.length === 0) return

  loading.value = true

  try {
    const chat = await $fetch('/api/chats', {
      method: 'POST',
      headers: { [headerName]: csrf() },
      body: {
        input: prompt,
        // A ghost chat is a plain chat: no workspace and no saved agent come with it.
        ...(ghost.value ? { ghost: true } : { agentId: agentId.value ?? undefined, workspaceId: workspaceId.value ?? undefined }),
        attachments: attachments.value.length > 0 ? await toApiAttachments() : undefined
      }
    })

    clear()
    if (!ghost.value) fetchChats()
    if (chat?.id) {
      router.push(`/chat/${chat.id}`)
    }
  } catch (err: any) {
    toast.add({
      title: 'Could not start the chat',
      description: err?.data?.statusMessage || err?.statusMessage || 'Please try again in a moment.',
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

/** Lobby starts a chat with nothing in it and opens on the stage, ready to be talked to. */
const lobbyLoading = ref(false)
async function talkToLobby() {
  if (lobbyLoading.value) return
  if (!await ensureSignedIn()) { openAuthModal('signin'); return }
  lobbyLoading.value = true
  try {
    const chat = await $fetch('/api/chats', { method: 'POST', headers: { [headerName]: csrf() }, body: { agentId: agentId.value ?? undefined, workspaceId: workspaceId.value ?? undefined } })
    fetchChats()
    if (chat?.id) router.push({ path: `/chat/${chat.id}`, query: { lobby: '1' } })
  } catch (err: any) {
    toast.add({ title: 'Could not start Lobby', description: err?.data?.statusMessage || err?.statusMessage || 'Please try again in a moment.', icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    lobbyLoading.value = false
  }
}

async function onSubmit() {
  const text = input.value.trim()
  if (!text && attachments.value.length === 0) return

  if (!await ensureSignedIn()) {
    // Not signed in: answer as OpenLobs (no model call) and keep the message for after sign-in.
    guestMessage.value = text || 'I have a file to share.'
    savePendingPrompt(text)
    input.value = ''
    return
  }
  createChat(input.value)
}

const proactiveAutomations = [
  {
    title: 'Automate my Inbox',
    description: 'Triage emails, draft replies, and organize your calendar automatically.',
    icon: 'i-logos-google-gmail',
    prompt: 'Create a workflow to monitor my Gmail for new client inquiries, draft a proposal, and save it to Google Drive.'
  },
  {
    title: 'Content Engine',
    description: 'Research, draft, humanize, and schedule posts for your social channels.',
    icon: 'i-lucide-pen-tool',
    prompt: 'Build a content pipeline that takes a topic, researches it, writes a viral LinkedIn post, and applies humanizing psychology.'
  },
  {
    title: 'Client Onboarding',
    description: 'Send contracts, create Slack channels, and notify the team.',
    icon: 'i-logos-slack-icon',
    prompt: 'Automate my client onboarding: when a contract is signed, create a Slack channel and notify the team.'
  },
  {
    title: 'Meeting Extraction',
    description: 'Pull action items and summaries from meeting transcripts.',
    icon: 'i-lucide-file-text',
    prompt: 'Create an agent that reads my meeting transcripts and automatically extracts action items into a structured document.'
  }
]

async function startAutomation(prompt: string) {
  // Workflow tools act on an account, so they need a signed-in user.
  if (!await ensureSignedIn()) {
    guestMessage.value = prompt
    savePendingPrompt(prompt)
    return
  }
  createChat(prompt)
}
</script>

<template>
  <UDashboardPanel
    id="home"
    class="min-h-0 flex-1 h-full"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <Navbar>
        <UTooltip :text="ghost ? 'Ghost mode is on. Nothing is saved or remembered.' : 'Ghost mode: nothing saved or remembered'">
          <UButton
            icon="i-lucide-ghost"
            :label="ghost ? 'Ghost mode' : undefined"
            color="neutral"
            :variant="ghost ? 'subtle' : 'ghost'"
            aria-label="Ghost mode"
            :aria-pressed="ghost"
            @click="ghost = !ghost"
          />
        </UTooltip>
      </Navbar>
    </template>

    <template #body>
      <UContainer class="flex-1 flex flex-col justify-center gap-6 sm:gap-8 py-12 max-w-4xl mx-auto">
        <GuestReply
          v-if="guestMessage"
          :message="guestMessage"
          @signup="openAuthModal('signup')"
          @signin="openAuthModal('signin')"
        />

        <div v-else class="text-center space-y-2">
          <UIcon v-if="ghost" name="i-lucide-ghost" class="mx-auto block size-8 text-muted" />
          <h1 class="text-3xl sm:text-4xl text-default font-semibold tracking-tight">
            {{ ghost ? 'Ghost mode' : greeting }}
          </h1>
          <p class="text-muted text-sm sm:text-base max-w-lg mx-auto">
            {{ ghost ? 'Nothing here is saved or added to your memory. It is gone when you leave this page.' : 'What would you like to get done today? Ask, or describe something to build.' }}
          </p>
        </div>

        <div class="flex flex-col gap-2 relative">
          <UChatPrompt
            v-grow
            v-model="input"
            class="soft-focus [view-transition-name:chat-prompt] shadow-sm border border-default rounded-2xl bg-elevated/50 backdrop-blur-md transition-all"
            color="primary"
            variant="subtle"
            :ui="{ base: 'px-3 py-2' }"
            placeholder="e.g. Build a workflow to read my emails and draft a summary..."
            @submit="onSubmit"
          >
          <template #header>
            <PromptAttachments
              :attachments="attachments"
              @remove="remove"
            />
          </template>

          <template #footer>
            <div class="flex items-center gap-2 pt-1">
              <PlusMenu id="home-attach-btn" :items="plus.items.value" :active="plus.active.value" />
              <input
                ref="fileInput"
                type="file"
                multiple
                class="hidden"
                :accept="ATTACH_ACCEPT"
                @change="onInputChange"
              >
              <ModelSelect v-if="!selectedAgent?.model" />
            </div>

            <!-- Nothing typed: the waveform is where Send is, with a small mic beside it. Typing turns both into Send. -->
            <div class="flex items-center gap-1.5">
              <DictateButton
                v-if="!guestMessage && dictation.supported.value && (dictation.listening.value || dictation.working.value || (!input.trim() && attachments.length === 0))"
                :listening="dictation.listening.value"
                :working="dictation.working.value"
                @press="dictation.toggle()"
              />
              <PromptVoiceButton
                v-if="!input.trim() && attachments.length === 0 && !guestMessage"
                :loading="lobbyLoading"
                @press="talkToLobby"
              />
              <UChatPromptSubmit
                v-else
                :loading="loading"
                color="primary"
                size="sm"
                class="rounded-full"
              />
            </div>
          </template>
        </UChatPrompt>
        </div>

        <!-- A saved agent that fits what is being typed -->
        <div v-if="agentHint && !guestMessage" class="mt-3 flex items-center gap-2 rounded-xl border border-default bg-elevated/50 px-3 py-2 text-sm" role="status">
          <UIcon name="i-lucide-bot" class="size-4 text-primary shrink-0" />
          <span class="text-muted min-w-0 truncate">This looks like a job for <span class="font-medium text-highlighted">{{ agentHint.name }}</span>.</span>
          <UButton label="Use it" size="xs" color="neutral" class="ml-auto shrink-0" @click="agentId = agentHint.id" />
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" class="shrink-0" aria-label="Dismiss suggestion" @click="dismissedHint = agentHint.id" />
        </div>

        <!-- Starting points: plain rows, no cards -->
        <div v-if="!guestMessage && !ghost">
          <p class="mb-1 px-3 text-xs font-medium text-muted">
            Start from
          </p>
          <ul class="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-4">
            <li
              v-for="automation in proactiveAutomations"
              :key="automation.title"
            >
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-elevated/60 focus-visible:bg-elevated/60 focus-visible:outline-2 focus-visible:outline-primary/30"
                @click="startAutomation(automation.prompt)"
              >
                <UIcon :name="automation.icon" class="size-4.5 shrink-0 text-muted" />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-highlighted">{{ automation.title }}</span>
                  <span class="block truncate text-xs text-muted">{{ automation.description }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
