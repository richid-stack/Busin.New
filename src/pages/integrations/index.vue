<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useIntegrations } from '../../composables/useIntegrations'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'

const router = useRouter()
const { openAuthModal, isAuthenticated, authReady } = useFirebaseAuth()
const {
  integrations,
  loading,
  loaded,
  unauthorized,
  loadError,
  canConnect,
  fetchIntegrations,
  installedIntegrations
} = useIntegrations()

const searchQuery = ref('')
const category = ref('all')

const CATEGORY_LABELS: Record<string, string> = {
  google: 'Google Workspace',
  communication: 'Communication',
  productivity: 'Productivity',
  project_management: 'Project management',
  crm: 'CRM',
  developer: 'Developer'
}

onMounted(() => {
  fetchIntegrations()
})

// Reload once sign-in completes (or after sign-out) so the list always matches the account.
watch(isAuthenticated, () => {
  fetchIntegrations()
})

const categories = computed(() => {
  const present = [...new Set(integrations.value.map(i => i.category))]
  return [
    { value: 'all', label: 'All' },
    ...present.map(value => ({ value, label: CATEGORY_LABELS[value] || value }))
  ]
})

const isFiltering = computed(() => Boolean(searchQuery.value.trim()) || category.value !== 'all')

const filteredIntegrations = computed(() => {
  let list = integrations.value
  if (!isFiltering.value) {
    // Connected apps already appear under "Installed".
    list = list.filter(i => i.status !== 'connected')
  }
  if (category.value !== 'all') {
    list = list.filter(i => i.category === category.value)
  }
  const query = searchQuery.value.toLowerCase().trim()
  if (query) {
    list = list.filter(i =>
      i.name.toLowerCase().includes(query) || i.description.toLowerCase().includes(query)
    )
  }
  return list
})

function goToDetails(provider: string) {
  router.push(`/integrations/${provider}`)
}

function clearFilters() {
  searchQuery.value = ''
  category.value = 'all'
}
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-2xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="mb-10">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">
          Integrations
        </h1>
        <p class="text-muted text-base md:text-lg">
          Connect your apps so OpenLobs can read from them and act on your behalf.
        </p>
      </div>

      <!-- Not signed in -->
      <div
        v-if="loaded && unauthorized"
        class="rounded-2xl border border-default bg-elevated/50 p-8 text-center"
      >
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to connect your apps</h2>
        <p class="text-sm text-muted mb-5">
          Integrations are tied to your account, so only you can use what you connect.
        </p>
        <UButton
          label="Sign in"
          icon="i-lucide-log-in"
          color="neutral"
          :loading="!authReady"
          @click="openAuthModal"
        />
      </div>

      <!-- Load failure -->
      <div
        v-else-if="loaded && loadError && integrations.length === 0"
        class="rounded-2xl border border-default bg-elevated/50 p-8 text-center"
      >
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-cloud-off" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Could not load integrations</h2>
        <p class="text-sm text-muted mb-5">{{ loadError }}</p>
        <UButton
          label="Try again"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="subtle"
          :loading="loading"
          @click="fetchIntegrations"
        />
      </div>

      <template v-else>
        <UAlert
          v-if="loaded && !canConnect"
          class="mb-8"
          color="warning"
          variant="subtle"
          icon="i-lucide-plug-zap"
          title="Connections are not set up yet"
          description="This server has no integration provider key, so apps cannot be connected right now."
        />

        <div class="mb-6">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            placeholder="Search integrations"
            size="lg"
            class="w-full"
            aria-label="Search integrations"
          />
        </div>

        <div
          v-if="categories.length > 2"
          class="mb-10 -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto no-scrollbar"
        >
          <UButton
            v-for="cat in categories"
            :key="cat.value"
            :label="cat.label"
            size="sm"
            class="rounded-full shrink-0"
            color="neutral"
            :variant="category === cat.value ? 'solid' : 'subtle'"
            @click="category = cat.value"
          />
        </div>

        <!-- Installed -->
        <section
          v-if="installedIntegrations.length > 0 && !isFiltering"
          class="mb-12"
        >
          <h2 class="text-lg font-medium text-highlighted mb-4">Installed</h2>
          <div class="grid grid-cols-3 sm:grid-cols-4 gap-3">
            <button
              v-for="item in installedIntegrations"
              :key="item.provider"
              type="button"
              class="group flex flex-col items-center gap-2 p-4 rounded-2xl border border-default bg-default hover:bg-elevated/60 hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-2 focus-visible:outline-primary"
              @click="goToDetails(item.provider)"
            >
              <UIcon :name="item.icon" class="size-8" />
              <span class="text-xs font-medium text-default truncate max-w-full">{{ item.name }}</span>
            </button>
          </div>
        </section>

        <!-- Catalog -->
        <section>
          <h2 class="text-lg font-medium text-highlighted mb-4">
            {{ isFiltering ? 'Results' : 'Popular' }}
          </h2>

          <div
            v-if="!loaded || (loading && integrations.length === 0)"
            class="py-12 flex justify-center"
          >
            <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
          </div>

          <div
            v-else-if="filteredIntegrations.length === 0"
            class="py-12 text-center"
          >
            <p class="text-sm text-muted mb-3">
              {{ isFiltering ? 'No integrations match your search.' : 'You have connected every available app.' }}
            </p>
            <UButton
              v-if="isFiltering"
              label="Clear filters"
              color="neutral"
              variant="link"
              @click="clearFilters"
            />
          </div>

          <div v-else class="flex flex-col gap-1">
            <button
              v-for="item in filteredIntegrations"
              :key="item.provider"
              type="button"
              class="group flex items-center justify-between p-4 sm:p-5 rounded-2xl border border-transparent hover:bg-elevated/60 transition-colors text-left focus-visible:outline-2 focus-visible:outline-primary w-full"
              @click="goToDetails(item.provider)"
            >
              <div class="flex items-center gap-4 sm:gap-5 min-w-0 pr-4">
                <div class="shrink-0 p-2.5 sm:p-3 rounded-xl bg-default shadow-sm border border-default flex items-center justify-center">
                  <UIcon :name="item.icon" class="size-6 sm:size-8" />
                </div>
                <div class="min-w-0">
                  <h3 class="text-base font-medium text-highlighted mb-0.5 truncate">{{ item.name }}</h3>
                  <p class="text-sm text-muted line-clamp-1 leading-snug">{{ item.description }}</p>
                  <p
                    v-if="item.supportedActionsCount"
                    class="text-xs text-dimmed mt-1.5"
                  >
                    {{ item.supportedActionsCount }} {{ item.supportedActionsCount === 1 ? 'action' : 'actions' }}
                  </p>
                </div>
              </div>

              <div class="shrink-0 text-muted group-hover:text-default transition-colors p-2">
                <UIcon
                  :name="item.status === 'connected' ? 'i-lucide-circle-check' : 'i-lucide-plus'"
                  class="size-6"
                  :class="item.status === 'connected' ? 'text-success' : ''"
                />
              </div>
            </button>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
