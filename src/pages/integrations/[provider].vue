<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntegrations } from '../../composables/useIntegrations'
import { useCsrf } from '../../composables/useCsrf'
import { auth } from '../../lib/firebase'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { $fetch } from 'ofetch'

const route = useRoute()
const router = useRouter()
const provider = route.params.provider as string
const { csrf, headerName } = useCsrf()

const { integrations, loading, fetchIntegrations, getIntegrationByProvider } = useIntegrations()

const integration = computed(() => getIntegrationByProvider(provider))

onMounted(() => {
  if (integrations.value.length === 0) {
    fetchIntegrations()
  }
  
  window.addEventListener('message', handleComposioMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handleComposioMessage)
})

function handleComposioMessage(e: MessageEvent) {
  if (e.data?.type === 'COMPOSIO_AUTH_SUCCESS') {
    fetchIntegrations()
  }
}

// Scopes review dialog state for Google
const isScopeReviewOpen = ref(false)
const selectedScopes = ref<string[]>([])
const isOAuthConnecting = ref(false)
const authError = ref<string | null>(null)
const connecting = ref(false)

function isScopeSelected(scope: string): boolean {
  return Array.isArray(selectedScopes.value) && selectedScopes.value.includes(scope)
}

function toggleScope(scope: string, checked?: boolean) {
  if (!Array.isArray(selectedScopes.value)) {
    selectedScopes.value = []
  }
  const isCurrentlySelected = selectedScopes.value.includes(scope)
  const shouldSelect = typeof checked === 'boolean' ? checked : !isCurrentlySelected

  if (shouldSelect && !isCurrentlySelected) {
    selectedScopes.value = [...selectedScopes.value, scope]
  } else if (!shouldSelect && isCurrentlySelected) {
    selectedScopes.value = selectedScopes.value.filter(s => s !== scope)
  }
}

const googleScopesConfig: Record<string, { scope: string; title: string; description: string; icon: string; defaultChecked: boolean }[]> = {
  gmail: [
    { scope: 'https://www.googleapis.com/auth/gmail.modify', title: 'Read & Send Emails', description: 'Allows AI agents to read incoming messages and draft replies', icon: 'i-logos-google-gmail', defaultChecked: true }
  ],
  google_drive: [
    { scope: 'https://www.googleapis.com/auth/drive.file', title: 'Create & Manage App Files', description: 'Store generated PDFs, proposals, and workflow exports in Drive', icon: 'i-logos-google-drive', defaultChecked: true }
  ],
  google_sheets: [
    { scope: 'https://www.googleapis.com/auth/spreadsheets', title: 'Read & Append Spreadsheets', description: 'Log leads, sync CRM data, and write automated rows', icon: 'i-logos-google-sheets', defaultChecked: true }
  ],
  google_docs: [
    { scope: 'https://www.googleapis.com/auth/documents', title: 'Generate & Edit Google Docs', description: 'Create rich briefs, contracts, and formatted documents', icon: 'i-logos-google-docs', defaultChecked: true }
  ],
  google_tasks: [
    { scope: 'https://www.googleapis.com/auth/tasks', title: 'Manage Tasks & To-Dos', description: 'Add deliverables, due dates, and update task statuses', icon: 'i-logos-google-tasks', defaultChecked: true }
  ],
  google_calendar: [
    { scope: 'https://www.googleapis.com/auth/calendar.events', title: 'Schedule Calendar Events', description: 'Find available slots and invite attendees to meetings', icon: 'i-logos-google-calendar', defaultChecked: true }
  ]
}

function handleConnect() {
  if (!integration.value) return
  // Google Workspace apps connect through the same hosted authorization flow as every other app.
  authError.value = null
  startComposioConnect()
}

async function startGoogleOAuthPopup() {
  if (!integration.value) return
  isOAuthConnecting.value = true
  authError.value = null

  try {
    const googleProvider = new GoogleAuthProvider()
    const scopesToRequest = Array.isArray(selectedScopes.value)
      ? selectedScopes.value
      : (typeof selectedScopes.value === 'string' ? [selectedScopes.value] : [])

    scopesToRequest.forEach(scope => {
      if (scope) {
        googleProvider.addScope(scope)
      }
    })
    googleProvider.setCustomParameters({ prompt: 'consent select_account' })

    const result = await signInWithPopup(auth, googleProvider)
    const credential = GoogleAuthProvider.credentialFromResult(result)
    const accessToken = credential?.accessToken

    await $fetch('/api/integrations/connect', {
      method: 'POST',
      headers: {
        [headerName]: csrf()
      },
      body: {
        provider: integration.value.provider,
        account: result.user.email || 'Google Account Connected',
        accessToken: accessToken || undefined
      }
    })

    isScopeReviewOpen.value = false
    await fetchIntegrations()
  } catch (err: any) {
    console.error('Google OAuth popup failed:', err)
    if (err?.code === 'auth/popup-closed-by-user') {
      authError.value = 'Popup was closed before completing authorization.'
    } else {
      authError.value = err?.message || 'Google authorization failed.'
    }
  } finally {
    isOAuthConnecting.value = false
  }
}

async function startComposioConnect() {
  if (!integration.value) return
  connecting.value = true
  try {
    const data = await $fetch<any>('/api/integrations/connect', {
      method: 'POST',
      headers: {
        [headerName]: csrf()
      },
      body: {
        provider: integration.value.provider,
        callbackUrl: window.location.origin + '/workflows'
      }
    })

    if (data?.redirectUrl) {
      const popup = window.open(
        data.redirectUrl,
        `Connect_${integration.value.provider}`,
        'width=600,height=750,status=yes,scrollbars=yes'
      )

      if (!popup) {
        authError.value = 'The authorization window was blocked. Allow pop-ups for this site and try again.'
        connecting.value = false
        return
      }

      const timer = setInterval(async () => {
        if (popup.closed) {
          clearInterval(timer)
          connecting.value = false
          await fetchIntegrations()
        }
      }, 1000)
    } else {
      await fetchIntegrations()
      connecting.value = false
    }
  } catch (err: any) {
    console.error('Connection failed:', err)
    authError.value = err?.data?.statusMessage || err?.statusMessage || err?.message || 'Could not start the connection.'
    connecting.value = false
  }
}

async function handleDisconnect() {
  if (!integration.value) return
  connecting.value = true
  try {
    await $fetch(`/api/integrations/${integration.value.provider}`, {
      method: 'DELETE',
      headers: {
        [headerName]: csrf()
      }
    })
    await fetchIntegrations()
  } catch (err) {
    console.error('Disconnect failed:', err)
  } finally {
    connecting.value = false
  }
}

const gradientClasses = [
  'bg-gradient-to-b from-blue-400/20 to-emerald-400/20 dark:from-blue-500/10 dark:to-emerald-500/10',
  'bg-gradient-to-b from-purple-400/20 to-pink-400/20 dark:from-purple-500/10 dark:to-pink-500/10',
  'bg-gradient-to-b from-amber-400/20 to-orange-400/20 dark:from-amber-500/10 dark:to-orange-500/10',
  'bg-gradient-to-b from-rose-400/20 to-red-400/20 dark:from-rose-500/10 dark:to-red-500/10'
]
const randomGradient = computed(() => {
  const hash = integration.value?.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0
  return gradientClasses[hash % gradientClasses.length]
})

function generatePrompts(name: string) {
  // Simple heuristic for prompt generation based on name if capabilities missing
  if (name.includes('Outlook') || name.includes('Gmail')) {
    return [
      `@${name} Summarize the most recent thread with procurement and pull the exact questions they asked so I can answer cleanly`,
      `@${name} Draft a reply to the latest customer message: acknowledge the concern, set expectations, and offer two ways forward`,
      `@${name} Find the top 5 emails I should respond to today based on urgency, seniority, and deadlines; include one-line suggested replies`
    ]
  }
  if (name.includes('Drive') || name.includes('Notion')) {
    return [
      `@${name} Find the Q3 roadmap document and summarize the key milestones for engineering`,
      `@${name} Create a new document titled "Client Kickoff Notes" and add my bullet points from the last meeting`
    ]
  }
  if (name.includes('Slack') || name.includes('Teams') || name.includes('Discord')) {
    return [
      `@${name} Post a message to the #general channel announcing the new release is deployed`,
      `@${name} Read the last 10 messages in the project channel and list any blockers mentioned by the team`
    ]
  }
  
  return [
    `@${name} Connect and fetch the most recent data related to my active projects.`,
    `@${name} Draft a summary report based on the latest activity in my account.`
  ]
}

const prompts = computed(() => {
  if (!integration.value) return []
  return generatePrompts(integration.value.name)
})
</script>

<template>
  <div class="h-full flex flex-col bg-white dark:bg-neutral-950 overflow-y-auto relative">
    <!-- Header bar -->
    <div class="sticky top-0 z-10 flex items-center justify-between px-4 py-4 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        class="rounded-full"
        @click="router.back()"
      />
      <h2 class="text-sm font-semibold truncate px-4">{{ integration?.name }}</h2>
      <UButton
        icon="i-lucide-share"
        color="neutral"
        variant="ghost"
        class="rounded-full"
      />
    </div>

    <div v-if="loading && !integration" class="flex-1 flex justify-center items-center">
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
    </div>

    <div v-else-if="integration" class="flex-1 pb-32">
      <div class="max-w-2xl mx-auto px-4 sm:px-6 pt-4 pb-12">
        <!-- Hero Identity -->
        <div class="mb-8">
          <div class="size-16 sm:size-20 rounded-2xl bg-white dark:bg-neutral-800 shadow-sm border border-neutral-100 dark:border-neutral-700/50 flex items-center justify-center mb-6">
            <UIcon :name="integration.icon" class="size-8 sm:size-10 text-foreground" />
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground mb-2">{{ integration.name }}</h1>
          <p class="text-muted text-base md:text-lg">{{ integration.description }}</p>
        </div>

        <!-- Prompts Section -->
        <div :class="['rounded-3xl p-6 sm:p-8 mb-10 space-y-4', randomGradient]">
          <div 
            v-for="(prompt, idx) in prompts" 
            :key="idx"
            class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur shadow-sm border border-white/20 dark:border-white/5 rounded-2xl p-5 text-sm md:text-base text-foreground leading-relaxed"
          >
            <span class="font-semibold text-primary">{{ prompt.split(' ')[0] }}</span>
            <span>{{ prompt.substring(prompt.split(' ')[0].length) }}</span>
          </div>
        </div>

        <!-- Information List -->
        <div>
          <h3 class="text-lg font-medium text-foreground mb-4">Information</h3>
          <div class="divide-y divide-neutral-100 dark:divide-neutral-800/50 border-y border-neutral-100 dark:border-neutral-800/50 text-sm">
            <div class="flex items-center justify-between py-4">
              <span class="text-muted">Capabilities</span>
              <span class="font-medium text-foreground text-right w-1/2 line-clamp-1">{{ integration.capabilities?.length ? integration.capabilities.length + ' actions' : 'Interactive' }}</span>
            </div>
            <div class="flex items-center justify-between py-4">
              <span class="text-muted">Developer</span>
              <span class="font-medium text-foreground">{{ integration.type === 'native' ? 'Google' : 'Composio' }}</span>
            </div>
            <div class="flex items-center justify-between py-4">
              <span class="text-muted">Category</span>
              <span class="font-medium text-foreground capitalize">{{ integration.category }}</span>
            </div>
            <div class="flex items-center justify-between py-4">
              <span class="text-muted">Website</span>
              <UButton :to="integration.externalLinks?.website || '#'" target="_blank" icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" />
            </div>
            <div class="flex items-center justify-between py-4">
              <span class="text-muted">Privacy Policy</span>
              <UButton :to="integration.externalLinks?.privacy || '#'" target="_blank" icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" />
            </div>
            <div class="flex items-center justify-between py-4">
              <span class="text-muted">Terms of Service</span>
              <UButton :to="integration.externalLinks?.terms || '#'" target="_blank" icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" />
            </div>
          </div>
        </div>

        <p class="text-xs text-muted mt-8 leading-relaxed">
          When connected to {{ integration.name }}, this app may share relevant chats and memories to help provide context for your requests. {{ integration.name }}'s use of this data is subject to their <a :href="integration.externalLinks?.terms || '#'" target="_blank" class="underline hover:text-foreground">terms</a> and <a :href="integration.externalLinks?.privacy || '#'" target="_blank" class="underline hover:text-foreground">privacy policy</a>.
        </p>
      </div>
    </div>

    <div v-else class="flex-1 flex justify-center items-center">
      <div class="text-center">
        <UIcon name="i-lucide-box" class="size-12 mx-auto text-muted mb-4" />
        <h2 class="text-lg font-medium text-foreground">Integration not found</h2>
        <p class="text-muted mt-1">The requested plugin does not exist.</p>
      </div>
    </div>

    <!-- Sticky Bottom Action Bar -->
    <div v-if="integration" class="fixed bottom-0 inset-x-0 md:pl-64 lg:pl-[280px] p-4 bg-gradient-to-t from-white via-white to-transparent dark:from-neutral-950 dark:via-neutral-950 pointer-events-none">
      <div class="max-w-2xl mx-auto pointer-events-auto">
        <UButton
          v-if="integration.status === 'connected'"
          label="Disconnect"
          color="error"
          variant="solid"
          size="xl"
          class="w-full justify-center rounded-full shadow-lg"
          :loading="connecting"
          @click="handleDisconnect"
        />
        <UButton
          v-else
          :label="integration.type === 'native' ? 'Connect via Google' : 'Install plugin'"
          color="black"
          variant="solid"
          size="xl"
          class="w-full justify-center rounded-full shadow-lg dark:bg-white dark:text-black dark:hover:bg-neutral-200"
          :loading="connecting"
          @click="handleConnect"
        />
      </div>
    </div>

    <!-- Google Scopes Modal -->
    <UModal v-model:open="isScopeReviewOpen" :ui="{ content: 'sm:max-w-md' }">
      <template #content>
        <div class="p-6">
          <div class="flex flex-col items-center mb-6">
            <div class="flex items-center justify-center gap-3 mb-4">
              <div class="size-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                <UIcon name="i-logos-vue" class="size-6 text-primary" />
              </div>
              <UIcon name="i-lucide-arrow-right-left" class="size-5 text-muted" />
              <div class="size-12 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center">
                <UIcon :name="integration?.icon || 'i-lucide-box'" class="size-6" />
              </div>
            </div>
            <h3 class="text-xl font-bold text-foreground text-center">Connect {{ integration?.name }}</h3>
            <p class="text-sm text-muted text-center mt-2">
              Select the permissions you want to grant to this application. 
              These scopes are requested via standard Google OAuth.
            </p>
          </div>

          <div v-if="integration?.provider && googleScopesConfig[integration.provider]" class="space-y-3 mb-8 max-h-60 overflow-y-auto px-1">
            <div
              v-for="scopeDef in googleScopesConfig[integration.provider]"
              :key="scopeDef.scope"
              class="flex items-start gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-primary/50 cursor-pointer transition-colors"
              @click="toggleScope(scopeDef.scope)"
            >
              <div class="flex-shrink-0 mt-0.5" @click.stop>
                <UCheckbox
                  :model-value="isScopeSelected(scopeDef.scope)"
                  @update:model-value="(val: boolean | 'indeterminate') => toggleScope(scopeDef.scope, val === true)"
                />
              </div>
              <div class="min-w-0 flex-1 select-none">
                <div class="flex items-center gap-2 mb-0.5">
                  <UIcon :name="scopeDef.icon" class="size-4" />
                  <span class="text-sm font-semibold text-foreground">{{ scopeDef.title }}</span>
                </div>
                <p class="text-xs text-muted leading-snug">{{ scopeDef.description }}</p>
                <p class="text-[10px] text-muted font-mono mt-1.5 truncate">{{ scopeDef.scope }}</p>
              </div>
            </div>
          </div>

          <div v-if="authError" class="mb-6 p-3 rounded-lg bg-error/10 border border-error/20 flex items-start gap-2">
            <UIcon name="i-lucide-alert-circle" class="size-4 text-error shrink-0 mt-0.5" />
            <p class="text-sm text-error">{{ authError }}</p>
          </div>

          <div class="flex items-center justify-end gap-3">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="isScopeReviewOpen = false"
            />
            <UButton
              label="Continue to Google"
              color="primary"
              variant="solid"
              icon="i-logos-google-icon"
              :loading="isOAuthConnecting"
              :disabled="!Array.isArray(selectedScopes) || selectedScopes.length === 0"
              @click="startGoogleOAuthPopup"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
