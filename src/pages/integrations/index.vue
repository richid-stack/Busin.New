<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useIntegrations } from '../../composables/useIntegrations'

const router = useRouter()
const { integrations, loading, fetchIntegrations, installedIntegrations } = useIntegrations()

const searchQuery = ref('')

onMounted(() => {
  fetchIntegrations()
})

const filteredIntegrations = computed(() => {
  let list = integrations.value.filter(i => i.status !== 'connected')
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim()
    list = list.filter(i => 
      i.name.toLowerCase().includes(query) || 
      i.description.toLowerCase().includes(query)
    )
  }
  return list
})

function goToDetails(provider: string) {
  router.push(`/integrations/${provider}`)
}
</script>

<template>
  <div class="h-full flex flex-col bg-white dark:bg-neutral-950 overflow-y-auto">
    <div class="max-w-2xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      
      <div class="mb-10">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-default mb-3">Integrations</h1>
        <p class="text-muted text-base md:text-lg">Work with AI across your favorite tools.</p>
      </div>

      <div class="mb-10">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="Search integrations"
          size="lg"
          class="w-full"
          :ui="{ wrapper: 'rounded-xl shadow-sm border-neutral-200 dark:border-neutral-800' }"
        />
      </div>

      <!-- Installed Section -->
      <div v-if="installedIntegrations.length > 0 && !searchQuery" class="mb-12">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-medium text-default">Installed</h2>
          <UIcon name="i-lucide-chevron-right" class="size-5 text-muted" />
        </div>
        <div class="flex flex-wrap gap-4">
          <button
            v-for="item in installedIntegrations"
            :key="item.provider"
            class="flex items-center justify-center p-3 sm:p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 shrink-0"
            @click="goToDetails(item.provider)"
          >
            <UIcon :name="item.icon" class="size-8 sm:size-10 text-default" />
          </button>
        </div>
      </div>

      <!-- Popular / Search Results Section -->
      <div>
        <h2 class="text-lg font-medium text-default mb-4">
          {{ searchQuery ? 'Search Results' : 'Popular' }}
        </h2>

        <div v-if="loading && integrations.length === 0" class="py-12 flex justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
        </div>
        
        <div v-else-if="filteredIntegrations.length === 0" class="py-12 text-center text-muted">
          No integrations found matching your search.
        </div>
        
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="item in filteredIntegrations"
            :key="item.provider"
            class="group flex items-center justify-between p-4 sm:p-5 rounded-2xl border border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors text-left focus:outline-none focus:bg-neutral-50 dark:focus:bg-neutral-900 w-full"
            @click="goToDetails(item.provider)"
          >
            <div class="flex items-center gap-4 sm:gap-5 min-w-0 pr-4">
              <div class="flex-shrink-0 p-2.5 sm:p-3 rounded-xl bg-white dark:bg-neutral-800 shadow-sm border border-neutral-100 dark:border-neutral-700/50 flex items-center justify-center relative">
                <UIcon :name="item.icon" class="size-6 sm:size-8 text-default" />
                <div v-if="item.type === 'native' || item.category === 'google'" class="absolute -bottom-1 -right-1 size-4 bg-white dark:bg-neutral-800 rounded-full flex items-center justify-center shadow-sm">
                  <UIcon name="i-lucide-sparkles" class="size-3 text-primary" />
                </div>
              </div>
              <div class="min-w-0">
                <h3 class="text-base font-medium text-default mb-0.5 truncate">{{ item.name }}</h3>
                <p class="text-sm text-muted line-clamp-1 leading-snug">{{ item.description }}</p>
                <div class="flex flex-wrap items-center gap-2 mt-2">
                  <span v-if="item.supportedEventsCount !== undefined" class="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                    Trigger: {{ item.supportedEventsCount }}
                  </span>
                  <span v-if="item.supportedActionsCount !== undefined" class="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20">
                    Action: {{ item.supportedActionsCount }}
                  </span>
                  <span class="inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-inset ring-neutral-200 dark:ring-neutral-700">
                    Auth: {{ item.type === 'native' ? 'Google OAuth' : 'Managed Connector' }}
                  </span>
                </div>

              </div>
            </div>
            
            <div class="flex-shrink-0 text-muted group-hover:text-default transition-colors p-2">
              <UIcon name="i-lucide-plus" class="size-6" />
            </div>
          </button>
        </div>
      </div>
      
    </div>
  </div>
</template>
