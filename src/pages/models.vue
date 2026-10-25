<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useModelProviders } from '../composables/useModelProviders'
import { useFirebaseAuth } from '../composables/useFirebaseAuth'
import { useUserSession } from '../composables/useUserSession'
import ModelProviderDialog from '../components/models/ModelProviderDialog.vue'
import type { ProviderRow } from '../types/models'

const ModalConfirm = defineAsyncComponent(() => import('../components/ModalConfirm.vue'))

const toast = useToast()
const overlay = useOverlay()
const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { providers, loading, loaded, unauthorized, loadError, fetchProviders, remove } = useModelProviders()

onMounted(fetchProviders)
// The server's own session decides what it will answer, so load (again) once that session exists.
watch(loggedIn, fetchProviders)

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

const dialogOpen = ref(false)
const chosen = ref<ProviderRow | null>(null)
function openProvider(p: ProviderRow) {
  if (unauthorized.value) return openAuthModal()
  chosen.value = p
  dialogOpen.value = true
}
// The row shown in the dialog follows the list, so it reflects a connection made a moment ago.
const current = computed(() => providers.value.find(p => p.id === chosen.value?.id) ?? chosen.value)

const mine = computed(() => providers.value.filter(p => p.connected))
const others = computed(() => providers.value.filter(p => !p.connected))

const deleteModal = overlay.create(ModalConfirm)
async function forget(p: ProviderRow) {
  const confirmed = await deleteModal.open({
    title: `Remove ${p.name}?`,
    description: 'The saved key and model list are deleted. Agents or tasks set to one of its models fall back to an error until you pick another model.',
    confirmLabel: 'Remove',
    color: 'error'
  }).result
  if (!confirmed) return
  try {
    await remove(p.id)
    toast.add({ title: `${p.name} removed`, icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not remove it', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const host = (url: string) => { try { return new URL(url).host } catch { return url } }
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="mb-10">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Models</h1>
        <p class="text-muted text-base md:text-lg">Bring your own key and use the models a provider offers today. Messages sent to your own models use your account with that provider, so they cost no OpenLobs credits.</p>
      </div>

      <div v-if="unauthorized" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to connect your own models</h2>
        <p class="text-sm text-muted mb-5">Your keys belong to your account.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <div v-else-if="loadError" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-cloud-off" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Could not load your providers</h2>
        <p class="text-sm text-muted mb-5">{{ loadError }}</p>
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchProviders" />
      </div>

      <div v-else-if="!loaded" class="py-12 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <template v-else>
        <section v-if="mine.length" class="mb-10" aria-labelledby="mine-heading">
          <h2 id="mine-heading" class="text-sm font-semibold text-highlighted mb-3">Connected</h2>
          <ul class="divide-y divide-default rounded-2xl border border-default bg-default">
            <li v-for="p in mine" :key="p.id" class="flex items-center gap-3 px-4 py-3">
              <BrandMark :icon="p.icon" :name="p.name" />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-highlighted">{{ p.name }}</span>
                  <UBadge :label="`${p.enabledCount} of ${p.modelsAvailable} on`" :color="p.enabledCount ? 'success' : 'neutral'" variant="subtle" size="sm" />
                </div>
                <p class="text-xs text-muted truncate">{{ p.baseUrl ? host(p.baseUrl) : 'Key saved' }}<span v-if="p.baseUrl"> · key saved</span></p>
              </div>
              <UButton label="Manage" size="sm" color="neutral" variant="subtle" :aria-label="`Manage ${p.name}`" @click="openProvider(p)" />
              <UButton icon="i-lucide-trash" size="sm" color="error" variant="ghost" :aria-label="`Remove ${p.name}`" @click="forget(p)" />
            </li>
          </ul>
        </section>

        <section aria-labelledby="add-heading">
          <h2 id="add-heading" class="text-sm font-semibold text-highlighted mb-1">{{ mine.length ? 'Add another provider' : 'Choose a provider' }}</h2>
          <p class="text-xs text-muted mb-3">Paste a key and OpenLobs asks the provider which models it offers right now. Nothing is hand-picked for you.</p>
          <ul class="divide-y divide-default rounded-2xl border border-default bg-default">
            <li v-for="p in others" :key="p.id" class="flex items-center gap-3 px-4 py-3">
              <BrandMark :icon="p.icon" :name="p.name" />
              <div class="min-w-0 flex-1">
                <span class="text-sm font-medium text-highlighted">{{ p.name }}</span>
                <p class="text-xs text-muted line-clamp-1">{{ p.keyHelp }}</p>
              </div>
              <UButton label="Connect" size="sm" color="neutral" variant="subtle" :aria-label="`Connect ${p.name}`" @click="openProvider(p)" />
            </li>
          </ul>
        </section>

        <p class="text-xs text-dimmed mt-6">Your own models work in chat, agents and tasks. Workflows use the built-in models for now.</p>
      </template>
    </div>

    <ModelProviderDialog v-model:open="dialogOpen" :provider="current" />
  </div>
</template>
