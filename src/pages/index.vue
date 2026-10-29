<script setup lang="ts">
import { ATTACH_ACCEPT } from '../utils/attachmentTypes'
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { $fetch } from 'ofetch'
import type { DropdownMenuItem } from '@nuxt/ui'
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
import AgentSelect from '../components/agents/AgentSelect.vue'
import { useAgents } from '../composables/useAgents'
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
watch(loggedIn, (signedIn) => { if (signedIn) fetchAgents() }, { immediate: true })

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
        agentId: agentId.value ?? undefined,
        attachments: attachments.value.length > 0 ? await toApiAttachments() : undefined
      }
    })

    clear()
    fetchChats()
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
    const chat = await $fetch('/api/chats', { method: 'POST', headers: { [headerName]: csrf() }, body: { agentId: agentId.value ?? undefined } })
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
      <Navbar />
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
          <h1 class="text-3xl sm:text-4xl text-default font-semibold tracking-tight">
            {{ greeting }}
          </h1>
          <p class="text-muted text-sm sm:text-base max-w-lg mx-auto">
            What would you like to automate today? Type a request or select a template to build an intelligent workflow.
          </p>
        </div>

        <div class="flex flex-col gap-2 relative">
          <UChatPrompt
            v-model="input"
            class="[view-transition-name:chat-prompt] shadow-sm border border-default rounded-2xl bg-elevated/50 backdrop-blur-md focus-within:ring-2 focus-within:ring-primary/20 transition-all"
            color="neutral"
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
              <UDropdownMenu
                :items="mcpItems"
                :content="{ align: 'start', side: 'top', collisionPadding: 12 }"
              >
                <UButton
                  id="home-attach-btn"
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
              <ModelSelect v-if="!selectedAgent?.model" />
              <AgentSelect v-model="agentId" />
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

        <!-- Proactive Automations -->
        <div v-if="!guestMessage" class="mt-8">
          <div class="flex items-center gap-2 mb-4 px-2 text-sm font-medium text-default">
            <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
            Suggested Workflows
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              v-for="automation in proactiveAutomations"
              :key="automation.title"
              type="button"
              class="group relative flex flex-col items-start p-5 bg-elevated border border-default rounded-2xl hover:border-primary/50 hover:shadow-lg focus-visible:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary/30 transition-all cursor-pointer text-left"
              @click="startAutomation(automation.prompt)"
            >
              <div class="p-2.5 rounded-xl border border-default shadow-sm mb-4 group-hover:scale-105 transition-transform">
                <UIcon :name="automation.icon" class="size-5" />
              </div>
              <h3 class="text-sm font-semibold text-default mb-1">{{ automation.title }}</h3>
              <p class="text-xs text-muted leading-relaxed">{{ automation.description }}</p>

              <div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                <UIcon name="i-lucide-arrow-right" class="size-4 text-primary" />
              </div>
            </button>
          </div>
        </div>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
