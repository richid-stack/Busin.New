const fs = require('fs');

const modalCode = `<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue'
import { useCsrf } from '../composables/useCsrf'
import type { IntegrationItem } from '../types/integrations'
import { auth } from '../lib/firebase'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { csrf, headerName } = useCsrf()

const integrations = ref<IntegrationItem[]>([])
const loading = ref(false)
const connectingProvider = ref<string | null>(null)
const searchQuery = ref('')
const selectedTab = ref<'all' | 'google' | 'apps'>('all')

// Scopes review dialog state
const isScopeReviewOpen = ref(false)
const pendingConnectingItem = ref<IntegrationItem | null>(null)
const isOAuthConnecting = ref(false)
const authSuccessItem = ref<IntegrationItem | null>(null)
const authError = ref<string | null>(null)

// Scope granular definitions for Google Services
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

const selectedScopes = ref<string[]>([])

async function fetchIntegrations() {
  loading.value = true
  try {
    const res = await fetch('/api/integrations')
    if (res.ok) {
      integrations.value = await res.json()
    }
  } catch (err) {
    console.warn('Could not load integrations list:', err)
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    fetchIntegrations()
  }
})

onMounted(() => {
  if (props.open) {
    fetchIntegrations()
  }
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'COMPOSIO_AUTH_SUCCESS') {
      fetchIntegrations()
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('message', () => {})
})

const filteredIntegrations = computed(() => {
  let list = integrations.value
  if (selectedTab.value === 'google') {
    list = list.filter(i => i.type === 'native' || i.category === 'google')
  } else if (selectedTab.value === 'apps') {
    list = list.filter(i => i.type === 'composio' || i.category !== 'google')
  }

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim()
    list = list.filter(i => 
      i.name.toLowerCase().includes(query) || 
      i.description.toLowerCase().includes(query) ||
      i.provider.toLowerCase().includes(query)
    )
  }

  return list
})

const googleIntegrations = computed(() => 
  filteredIntegrations.value.filter(i => i.type === 'native' || i.category === 'google'))

const thirdPartyIntegrations = computed(() => 
  filteredIntegrations.value.filter(i => i.type === 'composio' || i.category !== 'google'))

function handleConnect(item: IntegrationItem) {
  if (item.type === 'native' || item.category === 'google') {
    // Open Google Scope Review & Visual Connector Dialog
    pendingConnectingItem.value = item
    const config = googleScopesConfig[item.provider] || []
    selectedScopes.value = config.filter(s => s.defaultChecked).map(s => s.scope)
    authSuccessItem.value = null
    authError.value = null
    isOAuthConnecting.value = false
    isScopeReviewOpen.value = true
  } else {
    // Composio third-party flow
    startComposioConnect(item)
  }
}

async function startGoogleOAuthPopup() {
  if (!pendingConnectingItem.value) return
  const item = pendingConnectingItem.value
  isOAuthConnecting.value = true
  authError.value = null

  try {
    const provider = new GoogleAuthProvider()
    // Add all selected scopes
    selectedScopes.value.forEach(scope => {
      provider.addScope(scope)
    })
    provider.setCustomParameters({ prompt: 'consent select_account' })

    const result = await signInWithPopup(auth, provider)
    const credential = GoogleAuthProvider.credentialFromResult(result)
    const accessToken = credential?.accessToken

    // Register connected status on backend
    const res = await fetch('/api/integrations/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [headerName]: csrf()
      },
      body: JSON.stringify({
        provider: item.provider,
        account: result.user.email || 'Google Account Connected',
        accessToken: accessToken || undefined
      })
    })

    if (!res.ok) {
      throw new Error('Failed to save connection in database.')
    }

    authSuccessItem.value = item
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

async function startComposioConnect(item: IntegrationItem) {
  connectingProvider.value = item.provider
  try {
    const res = await fetch('/api/integrations/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [headerName]: csrf()
      },
      body: JSON.stringify({
        provider: item.provider,
        callbackUrl: window.location.origin + '/workflows'
      })
    })

    if (!res.ok) {
      throw new Error('Failed to connect service')
    }

    const data = await res.json()

    if (data.redirectUrl) {
      const popup = window.open(
        data.redirectUrl,
        \`Connect_\${item.provider}\`,
        'width=600,height=750,status=yes,scrollbars=yes'
      )

      const timer = setInterval(async () => {
        if (!popup || popup.closed) {
          clearInterval(timer)
          connectingProvider.value = null
          await fetchIntegrations()
        }
      }, 1000)
    } else {
      await fetchIntegrations()
      connectingProvider.value = null
    }
  } catch (err) {
    console.error('Connection failed:', err)
    connectingProvider.value = null
  }
}

async function handleDisconnect(item: IntegrationItem) {
  connectingProvider.value = item.provider
  try {
    const res = await fetch('/api/integrations/disconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [headerName]: csrf()
      },
      body: JSON.stringify({
        provider: item.provider
      })
    })

    if (res.ok) {
      await fetchIntegrations()
    }
  } catch (err) {
    console.error('Disconnect failed:', err)
  } finally {
    connectingProvider.value = null
  }
}

const testingProvider = ref<string | null>(null)
const testResult = ref<any>(null)

async function handleTestTool(item: IntegrationItem) {
  testingProvider.value = item.provider
  testResult.value = null
  try {
    const res = await fetch('/api/integrations/test-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [headerName]: csrf()
      },
      body: JSON.stringify({
        provider: item.provider
      })
    })
    const data = await res.json()
    testResult.value = {
      provider: item.name,
      ...data
    }
  } catch (err: any) {
    testResult.value = {
      provider: item.name,
      toolSlug: 'UNKNOWN',
      toolName: 'Verification Tool',
      success: false,
      connected: false,
      message: err?.message || 'Failed to execute test call.'
    }
  } finally {
    testingProvider.value = null
  }
}
</script>

<template>
  <div>
    <UModal
      :open="open"
      title="Connected Services & Integrations"
      description="Manage native Google Workspace apps and connected third-party platforms for your workflows."
      :ui="{
        content: 'max-w-4xl'
      }"
      @update:open="emit('update:open', $event)"
    >
      <template #body>
        <div class="space-y-4">
          <!-- Filter / Search toolbar -->
          <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b border-neutral-200 dark:border-neutral-800">
            <div class="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800/80 p-1 rounded-lg">
              <button
                type="button"
                class="px-3 py-1 text-xs font-medium rounded-md transition-colors"
                :class="selectedTab === 'all' ? 'bg-white dark:bg-neutral-900 text-foreground shadow-xs' : 'text-muted hover:text-foreground'"
                @click="selectedTab = 'all'"
              >
                All Services
              </button>
              <button
                type="button"
                class="px-3 py-1 text-xs font-medium rounded-md transition-colors"
                :class="selectedTab === 'google' ? 'bg-white dark:bg-neutral-900 text-foreground shadow-xs' : 'text-muted hover:text-foreground'"
                @click="selectedTab = 'google'"
              >
                Google Workspace
              </button>
              <button
                type="button"
                class="px-3 py-1 text-xs font-medium rounded-md transition-colors"
                :class="selectedTab === 'apps' ? 'bg-white dark:bg-neutral-900 text-foreground shadow-xs' : 'text-muted hover:text-foreground'"
                @click="selectedTab = 'apps'"
              >
                Third-Party Apps
              </button>
            </div>

            <div class="w-full sm:w-64">
              <UInput
                v-model="searchQuery"
                placeholder="Search integrations..."
                icon="i-lucide-search"
                size="sm"
              />
            </div>
          </div>

          <!-- Scrollable list -->
          <div class="overflow-y-auto max-h-[55vh] pr-1 space-y-6">
            <!-- Google Native Section -->
            <div v-if="googleIntegrations.length > 0 && (selectedTab === 'all' || selectedTab === 'google')" class="space-y-2.5">
              <div class="flex items-center justify-between">
                <h4 class="text-xs font-semibold uppercase tracking-wider text-muted">Google Workspace (Native Direct)</h4>
                <span class="text-[11px] text-muted">Direct Google OAuth</span>
              </div>
              
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div
                  v-for="item in googleIntegrations"
                  :key="item.provider"
                  class="flex items-start justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
                >
                  <div class="flex items-start gap-3 min-w-0 pr-2">
                    <div class="p-2 rounded-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shrink-0">
                      <UIcon :name="item.icon" class="size-5" />
                    </div>
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="font-medium text-sm text-foreground truncate">{{ item.name }}</span>
                        <span
                          v-if="item.status === 'connected'"
                          class="inline-flex items-center px-1.5 py-0.2 text-[10px] font-medium rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        >
                          Connected
                        </span>
                      </div>
                      <p class="text-xs text-muted line-clamp-1 mt-0.5">{{ item.description }}</p>
                      <p v-if="item.status === 'connected'" class="text-[11px] font-mono text-muted mt-1 truncate">
                        {{ item.account }}
                      </p>
                    </div>
                  </div>

                  <div class="shrink-0 flex items-center gap-1.5">
                    <UButton
                      label="Test"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-play"
                      :loading="testingProvider === item.provider"
                      @click="handleTestTool(item)"
                    />
                    <UButton
                      v-if="item.status === 'connected'"
                      label="Disconnect"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :loading="connectingProvider === item.provider"
                      @click="handleDisconnect(item)"
                    />
                    <UButton
                      v-else
                      label="Connect"
                      color="primary"
                      variant="subtle"
                      size="xs"
                      :loading="connectingProvider === item.provider"
                      @click="handleConnect(item)"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Third-Party Applications Section -->
            <div v-if="thirdPartyIntegrations.length > 0 && (selectedTab === 'all' || selectedTab === 'apps')" class="space-y-2.5">
              <div class="flex items-center justify-between">
                <h4 class="text-xs font-semibold uppercase tracking-wider text-muted">External Platforms & Services</h4>
                <span class="text-[11px] text-muted">Single-click Connection</span>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div
                  v-for="item in thirdPartyIntegrations"
                  :key="item.provider"
                  class="flex items-start justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
                >
                  <div class="flex items-start gap-3 min-w-0 pr-2">
                    <div class="p-2 rounded-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shrink-0">
                      <UIcon :name="item.icon" class="size-5" />
                    </div>
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="font-medium text-sm text-foreground truncate">{{ item.name }}</span>
                        <span
                          v-if="item.status === 'connected'"
                          class="inline-flex items-center px-1.5 py-0.2 text-[10px] font-medium rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        >
                          Connected
                        </span>
                      </div>
                      <p class="text-xs text-muted line-clamp-1 mt-0.5">{{ item.description }}</p>
                      <p v-if="item.status === 'connected'" class="text-[11px] font-mono text-muted mt-1 truncate">
                        {{ item.account }}
                      </p>
                    </div>
                  </div>

                  <div class="shrink-0 flex items-center gap-1.5">
                    <UButton
                      label="Test"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-play"
                      :loading="testingProvider === item.provider"
                      @click="handleTestTool(item)"
                    />
                    <UButton
                      v-if="item.status === 'connected'"
                      label="Disconnect"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :loading="connectingProvider === item.provider"
                      @click="handleDisconnect(item)"
                    />
                    <UButton
                      v-else
                      label="Connect"
                      color="primary"
                      variant="subtle"
                      size="xs"
                      :loading="connectingProvider === item.provider"
                      @click="handleConnect(item)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex items-center justify-between w-full">
          <span class="text-xs text-muted">
            Integrations are securely isolated per user account.
          </span>
          <UButton
            label="Done"
            color="neutral"
            variant="subtle"
            size="sm"
            @click="emit('update:open', false)"
          />
        </div>
      </template>
    </UModal>

    <!-- Visual OAuth Connector Modal (Composio Style Flow & Scopes Checklist) -->
    <UModal
      :open="isScopeReviewOpen"
      :ui="{
        content: 'max-w-md'
      }"
      @update:open="isScopeReviewOpen = $event"
    >
      <template #content>
        <div class="relative p-6 space-y-6 overflow-hidden bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xl">
          <!-- Ambient Background Glow -->
          <div class="absolute -top-24 -left-24 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div class="absolute -top-24 -right-24 w-56 h-56 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          <!-- Header Connector Visualization (Left: App Favicon, Middle: Animated Parallel Lanes / Success, Right: Google Service Favicon) -->
          <div class="flex flex-col items-center justify-center pt-2">
            <div class="flex items-center justify-center gap-4">
              <!-- Left: Current App Logo / Favicon -->
              <div class="size-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm flex items-center justify-center p-2.5 relative">
                <UIcon name="i-lucide-bot" class="size-8 text-primary" />
              </div>

              <!-- Middle: Connection Status / Animated 3 Parallel Running Lanes -->
              <div class="flex flex-col items-center justify-center px-1">
                <!-- If Success -->
                <div v-if="authSuccessItem" class="size-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md animate-bounce">
                  <UIcon name="i-lucide-check" class="size-5" />
                </div>
                
                <!-- If Connecting / Pending: 3 Parallel Animated Lanes -->
                <div v-else class="flex flex-col gap-1.5 w-14 py-2">
                  <div class="h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden relative">
                    <div class="h-full bg-primary rounded-full absolute inset-y-0" :class="isOAuthConnecting ? 'w-1/2 animate-[marquee_1.2s_linear_infinite]' : 'w-full opacity-40'" />
                  </div>
                  <div class="h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden relative">
                    <div class="h-full bg-emerald-500 rounded-full absolute inset-y-0" :class="isOAuthConnecting ? 'w-1/2 animate-[marquee_1.6s_linear_infinite_reverse]' : 'w-full opacity-40'" />
                  </div>
                  <div class="h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden relative">
                    <div class="h-full bg-primary rounded-full absolute inset-y-0" :class="isOAuthConnecting ? 'w-1/2 animate-[marquee_1.4s_linear_infinite]' : 'w-full opacity-40'" />
                  </div>
                </div>
              </div>

              <!-- Right: Target Service Favicon -->
              <div class="size-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm flex items-center justify-center p-2.5 relative">
                <UIcon :name="pendingConnectingItem?.icon || 'i-logos-google-icon'" class="size-8" />
              </div>
            </div>

            <!-- Title & Subtitle -->
            <div class="text-center mt-5 space-y-1">
              <h3 class="font-bold text-base text-foreground">
                <template v-if="authSuccessItem">
                  Successfully connected {{ pendingConnectingItem?.name }}!
                </template>
                <template v-else-if="isOAuthConnecting">
                  Authorizing {{ pendingConnectingItem?.name }}...
                </template>
                <template v-else>
                  Connect {{ pendingConnectingItem?.name }}
                </template>
              </h3>
              <p class="text-xs text-muted max-w-xs mx-auto">
                <template v-if="authSuccessItem">
                  Your account is securely linked and ready to run automated workflows.
                </template>
                <template v-else>
                  Select the permissions you want to grant for your automated workflows.
                </template>
              </p>
            </div>
          </div>

          <!-- Permissions / Scopes Selection Card (Tick all appropriate places) -->
          <div v-if="!authSuccessItem" class="space-y-3">
            <div class="flex items-center justify-between text-xs text-muted font-medium px-1">
              <span>Requested Permissions</span>
              <span>Granular Access</span>
            </div>

            <div class="space-y-2 max-h-44 overflow-y-auto pr-1">
              <div
                v-for="s in (googleScopesConfig[pendingConnectingItem?.provider || ''] || [])"
                :key="s.scope"
                class="flex items-start gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70 transition-colors cursor-pointer"
                @click="selectedScopes.includes(s.scope) ? selectedScopes = selectedScopes.filter(x => x !== s.scope) : selectedScopes.push(s.scope)"
              >
                <input
                  type="checkbox"
                  :value="s.scope"
                  v-model="selectedScopes"
                  class="mt-0.5 rounded border-neutral-300 dark:border-neutral-700 text-primary focus:ring-primary size-4"
                  @click.stop
                />
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-semibold text-foreground">{{ s.title }}</div>
                  <div class="text-[11px] text-muted leading-tight mt-0.5">{{ s.description }}</div>
                </div>
              </div>
            </div>

            <!-- Error Banner if any -->
            <div v-if="authError" class="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
              <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
              <span>{{ authError }}</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3 pt-2">
            <template v-if="authSuccessItem">
              <UButton
                label="Done & Close"
                color="primary"
                variant="solid"
                class="w-full justify-center"
                size="md"
                @click="isScopeReviewOpen = false"
              />
            </template>
            <template v-else>
              <UButton
                label="Cancel"
                color="neutral"
                variant="ghost"
                class="flex-1 justify-center"
                size="md"
                :disabled="isOAuthConnecting"
                @click="isScopeReviewOpen = false"
              />
              <UButton
                label="Authorize with Google"
                color="primary"
                variant="solid"
                icon="i-logos-google-icon"
                class="flex-1 justify-center"
                size="md"
                :loading="isOAuthConnecting"
                :disabled="selectedScopes.length === 0"
                @click="startGoogleOAuthPopup"
              />
            </template>
          </div>

          <!-- Trust Footer -->
          <div class="text-center text-[11px] text-muted flex items-center justify-center gap-1 pt-1 border-t border-neutral-100 dark:border-neutral-800">
            <UIcon name="i-lucide-shield-check" class="size-3.5 text-emerald-500" />
            <span>Encrypted OAuth2 session secured by Google Identity</span>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
`;

fs.writeFileSync('src/components/ModalIntegrations.vue', modalCode);
console.log('Successfully written upgraded ModalIntegrations.vue');
