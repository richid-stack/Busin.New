<script setup lang="ts">
import { computed, onMounted, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClipboard } from '@vueuse/core'
import { useIntegrations } from '../../composables/useIntegrations'
import { useIntegrationConnect } from '../../composables/useIntegrationConnect'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'

const ModalConfirm = defineAsyncComponent(() => import('../../components/ModalConfirm.vue'))

const route = useRoute()
const router = useRouter()
const toast = useToast()
const overlay = useOverlay()
const { copy } = useClipboard()
const { openAuthModal, isAuthenticated } = useFirebaseAuth()

const provider = computed(() => String(route.params.provider || ''))

const {
  integrations,
  loading,
  loaded,
  unauthorized,
  canConnect,
  fetchIntegrations,
  getIntegrationByProvider
} = useIntegrations()
const { busyProvider, connect, disconnect } = useIntegrationConnect()

const integration = computed(() => getIntegrationByProvider(provider.value))
const isConnected = computed(() => integration.value?.status === 'connected')
const busy = computed(() => busyProvider.value === provider.value)

const CATEGORY_LABELS: Record<string, string> = {
  google: 'Google Workspace',
  communication: 'Communication',
  productivity: 'Productivity',
  project_management: 'Project management',
  crm: 'CRM',
  developer: 'Developer'
}
const categoryLabel = computed(() =>
  integration.value ? (CATEGORY_LABELS[integration.value.category] || integration.value.category) : ''
)

onMounted(() => {
  if (integrations.value.length === 0) fetchIntegrations()
})

watch(isAuthenticated, () => {
  fetchIntegrations()
})

const disconnectModal = overlay.create(ModalConfirm)

async function handleDisconnect() {
  if (!integration.value) return
  const confirmed = await disconnectModal.open({
    title: `Disconnect ${integration.value.name}?`,
    description: 'Chats and workflows will no longer be able to use this app until you connect it again.',
    confirmLabel: 'Disconnect',
    color: 'error'
  }).result
  if (confirmed) await disconnect(provider.value)
}

async function copyLink() {
  await copy(window.location.href)
  toast.add({ title: 'Link copied', icon: 'i-lucide-link', color: 'neutral' })
}

const gradientClasses = [
  'bg-gradient-to-b from-blue-400/20 to-emerald-400/20 dark:from-blue-500/10 dark:to-emerald-500/10',
  'bg-gradient-to-b from-purple-400/20 to-pink-400/20 dark:from-purple-500/10 dark:to-pink-500/10',
  'bg-gradient-to-b from-amber-400/20 to-orange-400/20 dark:from-amber-500/10 dark:to-orange-500/10',
  'bg-gradient-to-b from-rose-400/20 to-red-400/20 dark:from-rose-500/10 dark:to-red-500/10'
]
const accentGradient = computed(() => {
  const hash = (integration.value?.name || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return gradientClasses[hash % gradientClasses.length]
})

function examplePrompts(name: string, category: string): string[] {
  switch (category) {
    case 'google':
    case 'communication':
      return [
        `Summarize what's new in ${name} since yesterday and list anything that needs my reply.`,
        `Find the latest ${name} thread about our current project and pull out the open questions.`,
        `Draft a short update in ${name} that recaps this week's progress for the team.`
      ]
    case 'project_management':
      return [
        `List everything in ${name} that is overdue or due this week, grouped by owner.`,
        `Create a task in ${name} for each action item from my last meeting notes.`
      ]
    case 'crm':
      return [
        `Pull the ${name} deals that have gone quiet for two weeks and draft a follow-up for each.`,
        `Summarize the newest ${name} contacts and what we know about them.`
      ]
    case 'developer':
      return [
        `Show me the open items in ${name} that need my attention today.`,
        `Summarize the most recent activity in ${name} for my active projects.`
      ]
    default:
      return [
        `Find the most recent items in ${name} related to my active projects.`,
        `Create a short summary report from the latest activity in ${name}.`
      ]
  }
}

const prompts = computed(() =>
  integration.value ? examplePrompts(integration.value.name, integration.value.category) : []
)

function usePrompt(prompt: string) {
  router.push({ path: '/', query: { prompt } })
}

const links = computed(() => {
  const l = integration.value?.externalLinks
  return [
    { label: 'Website', href: l?.website },
    { label: 'Privacy policy', href: l?.privacy },
    { label: 'Terms of service', href: l?.terms }
  ].filter(item => item.href) as { label: string, href: string }[]
})
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <!-- Header bar -->
    <div class="sticky top-0 z-10 flex items-center justify-between px-4 py-4 bg-default/80 backdrop-blur-md">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        class="rounded-full"
        aria-label="Back to integrations"
        to="/integrations"
      />
      <h2 class="text-sm font-semibold text-highlighted truncate px-4">{{ integration?.name }}</h2>
      <UButton
        icon="i-lucide-link"
        color="neutral"
        variant="ghost"
        class="rounded-full"
        aria-label="Copy link"
        :class="{ invisible: !integration }"
        @click="copyLink"
      />
    </div>

    <div v-if="!loaded || (loading && !integration)" class="flex-1 flex justify-center items-center">
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
    </div>

    <div v-else-if="unauthorized" class="flex-1 flex justify-center items-center px-6">
      <div class="text-center max-w-sm">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-elevated/50 shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-lg font-medium text-highlighted">Sign in to continue</h2>
        <p class="text-sm text-muted mt-1 mb-5">Integrations are tied to your account.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>
    </div>

    <div v-else-if="integration" class="flex-1">
      <div class="max-w-2xl mx-auto px-4 sm:px-6 pt-4 pb-12">
        <!-- Hero -->
        <div class="mb-8">
          <div class="size-16 sm:size-20 rounded-2xl bg-default shadow-sm border border-default flex items-center justify-center mb-6">
            <UIcon :name="integration.icon" class="size-8 sm:size-10" />
          </div>
          <div class="flex flex-wrap items-center gap-3 mb-2">
            <h1 class="text-3xl font-bold tracking-tight text-highlighted">{{ integration.name }}</h1>
            <UBadge
              v-if="isConnected"
              label="Connected"
              icon="i-lucide-circle-check"
              color="success"
              variant="subtle"
            />
          </div>
          <p class="text-muted text-base md:text-lg">{{ integration.description }}</p>
        </div>

        <!-- Example prompts -->
        <section class="mb-10">
          <p class="text-sm font-medium text-muted mb-3">Try asking</p>
          <div :class="['rounded-3xl p-4 sm:p-6 space-y-3', accentGradient]">
            <button
              v-for="(prompt, idx) in prompts"
              :key="idx"
              type="button"
              class="group w-full text-left bg-default/80 backdrop-blur shadow-sm border border-default rounded-2xl p-5 text-sm md:text-base text-default leading-relaxed hover:bg-default hover:-translate-y-0.5 hover:shadow-md transition-all focus-visible:outline-2 focus-visible:outline-primary flex items-start gap-3"
              @click="usePrompt(`@${integration.name} ${prompt}`)"
            >
              <span class="flex-1">
                <span class="font-semibold text-primary">@{{ integration.name }}</span>
                {{ ' ' + prompt }}
              </span>
              <UIcon
                name="i-lucide-arrow-up-right"
                class="size-4 mt-1 text-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </button>
          </div>
        </section>

        <!-- Information -->
        <section>
          <h3 class="text-lg font-medium text-highlighted mb-4">Information</h3>
          <div class="divide-y divide-default border-y border-default text-sm">
            <div v-if="isConnected" class="flex items-center justify-between gap-4 py-4">
              <span class="text-muted">Account</span>
              <span class="font-medium text-default text-right truncate">{{ integration.account }}</span>
            </div>
            <div class="flex items-center justify-between gap-4 py-4">
              <span class="text-muted">Actions</span>
              <span class="font-medium text-default">{{ integration.supportedActionsCount || integration.capabilities?.length || 0 }}</span>
            </div>
            <div class="flex items-center justify-between gap-4 py-4">
              <span class="text-muted">Category</span>
              <span class="font-medium text-default">{{ categoryLabel }}</span>
            </div>
            <a
              v-for="link in links"
              :key="link.label"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-between gap-4 py-4 hover:bg-elevated/40 transition-colors -mx-2 px-2 rounded-lg"
            >
              <span class="text-muted">{{ link.label }}</span>
              <UIcon name="i-lucide-external-link" class="size-4 text-muted" />
            </a>
          </div>
        </section>

        <p class="text-xs text-muted mt-8 leading-relaxed">
          When {{ integration.name }} is connected, OpenLobs can read from it and take actions you ask for in chats and workflows.
          {{ integration.name }}'s handling of your data follows its own terms and privacy policy.
        </p>
      </div>
    </div>

    <div v-else class="flex-1 flex justify-center items-center px-6">
      <div class="text-center">
        <UIcon name="i-lucide-box" class="size-12 mx-auto text-muted mb-4" />
        <h2 class="text-lg font-medium text-highlighted">Integration not found</h2>
        <p class="text-muted mt-1 mb-5">We don't have an integration called "{{ provider }}".</p>
        <UButton label="Browse integrations" to="/integrations" color="neutral" variant="subtle" />
      </div>
    </div>

    <!-- Sticky action bar -->
    <div
      v-if="integration && !unauthorized"
      class="sticky bottom-0 z-10 px-4 sm:px-6 py-4 bg-gradient-to-t from-default via-default to-transparent"
    >
      <div class="max-w-2xl mx-auto">
        <UButton
          v-if="isConnected"
          label="Disconnect"
          color="error"
          variant="subtle"
          size="xl"
          class="w-full justify-center rounded-full"
          :loading="busy"
          @click="handleDisconnect"
        />
        <UButton
          v-else-if="!isAuthenticated"
          label="Sign in to connect"
          icon="i-lucide-log-in"
          color="neutral"
          size="xl"
          class="w-full justify-center rounded-full shadow-lg"
          @click="openAuthModal"
        />
        <template v-else>
          <UButton
            :label="canConnect ? `Connect ${integration.name}` : 'Connections unavailable'"
            color="neutral"
            size="xl"
            class="w-full justify-center rounded-full shadow-lg"
            :loading="busy"
            :disabled="!canConnect || (busyProvider !== null && !busy)"
            @click="connect(provider)"
          />
          <p v-if="!canConnect" class="text-xs text-muted text-center mt-2">
            This server has no integration provider key configured.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
