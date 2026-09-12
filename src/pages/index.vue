<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { $fetch } from 'ofetch'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useChats } from '../composables/useChats'
import { useCsrf } from '../composables/useCsrf'
import { useUserSession } from '../composables/useUserSession'
import Navbar from '../components/Navbar.vue'

import { compressImage } from '../utils/image'

const { fetchChats } = useChats()
const { csrf, headerName } = useCsrf()
const { user } = useUserSession()
const input = ref('')
const loading = ref(false)
const router = useRouter()
const attachments = ref<Array<{ file: File, url: string }>>([])
const fileInput = ref<HTMLInputElement | null>(null)

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

const greeting = computed(() => {
  const hour = new Date().getHours()
  let timeGreeting = 'Good evening'
  if (hour < 12) timeGreeting = 'Good morning'
  else if (hour < 18) timeGreeting = 'Good afternoon'

  const name = user.value?.name?.split(' ')[0] || user.value?.username

  return name ? `${timeGreeting}, ${name}` : `${timeGreeting}`
})

async function createChat(prompt: string) {
  if (!prompt.trim() && attachments.value.length === 0) return

  input.value = prompt
  loading.value = true

  let experimental_attachments = undefined
  if (attachments.value.length > 0) {
    experimental_attachments = await Promise.all(
      attachments.value.map(async (attachment) => {
        return new Promise<{ name: string; contentType: string; url: string }>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => {
            resolve({
              name: attachment.file.name,
              contentType: attachment.file.type,
              url: reader.result as string
            })
          }
          reader.readAsDataURL(attachment.file)
        })
      })
    )
  }

  try {
    const chat = await $fetch('/api/chats', {
      method: 'POST',
      headers: { [headerName]: csrf() },
      body: {
        input: prompt,
        attachments: experimental_attachments
      }
    })

    await fetchChats()
    router.push(`/chat/${chat?.id}`)
  } finally {
    loading.value = false
  }
}

function onSubmit() {
  createChat(input.value)
}

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
        onSubmit()
      }
    },
    {
      label: 'Connect Slack',
      icon: 'i-logos-slack-icon',
      onSelect: () => {
        input.value = 'Connect Slack workspace and alerts'
        onSubmit()
      }
    },
    {
      label: 'Connect Google Drive',
      icon: 'i-logos-google-drive',
      onSelect: () => {
        input.value = 'Connect Google Drive and check shared folders'
        onSubmit()
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
</script>

<template>
  <UDashboardPanel
    id="home"
    class="min-h-0 flex-1 h-full bg-background"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <Navbar />
    </template>

    <template #body>
      <UContainer class="flex-1 flex flex-col justify-center gap-6 sm:gap-8 py-12 max-w-4xl mx-auto">
        <div class="text-center space-y-2">
          <h1 class="text-3xl sm:text-4xl text-foreground font-semibold tracking-tight">
            {{ greeting }}
          </h1>
          <p class="text-muted text-sm sm:text-base max-w-lg mx-auto">
            What would you like to automate today? Type a request or select a template to build an intelligent workflow.
          </p>
        </div>

        <div class="flex flex-col gap-2 relative">
          <!-- Active Connections Context Pills -->
          <div class="flex items-center gap-2 px-1 mb-1">
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
            v-model="input"
            :status="loading ? 'streaming' : 'ready'"
            class="[view-transition-name:chat-prompt] shadow-sm border border-default rounded-2xl bg-elevated/50 backdrop-blur-md focus-within:ring-2 focus-within:ring-primary/20 transition-all"
            color="neutral"
            variant="ghost"
            :ui="{ base: 'px-3 py-2', input: 'text-base placeholder:text-muted' }"
            placeholder="e.g. Build a workflow to read my emails and draft a summary..."
            @submit="onSubmit"
          >
          <template
            v-if="attachments.length > 0"
            #header
          >
            <div class="flex flex-wrap gap-2 px-3 pt-3">
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
                  class="relative group flex items-center gap-2 bg-elevated border border-default rounded-md p-1.5 text-xs max-w-[12rem] pr-8"
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
                accept="image/*,application/pdf,text/plain,.doc,.docx"
                @change="handleFileSelect"
              >
              <ModelSelect />
            </div>

            <UChatPromptSubmit
              color="primary"
              size="sm"
              class="rounded-full"
            />
          </template>
        </UChatPrompt>
        </div>

        <!-- Proactive Automations -->
        <div class="mt-8">
          <div class="flex items-center gap-2 mb-4 px-2 text-sm font-medium text-foreground">
            <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
            Suggested Workflows
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              v-for="automation in proactiveAutomations"
              :key="automation.title"
              class="group relative flex flex-col items-start p-5 bg-elevated border border-default rounded-2xl hover:border-primary/50 hover:shadow-lg transition-all cursor-pointer text-left"
              @click="createChat(automation.prompt)"
            >
              <div class="p-2.5 bg-background rounded-xl border border-default shadow-sm mb-4 group-hover:scale-105 transition-transform">
                <UIcon :name="automation.icon" class="size-5" />
              </div>
              <h3 class="text-sm font-semibold text-foreground mb-1">{{ automation.title }}</h3>
              <p class="text-xs text-muted leading-relaxed">{{ automation.description }}</p>
              
              <div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <UIcon name="i-lucide-arrow-right" class="size-4 text-primary" />
              </div>
            </div>
          </div>
        </div>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
