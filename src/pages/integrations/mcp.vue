<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useMcpServers } from '../../composables/useMcpServers'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import McpServerForm from '../../components/mcp/McpServerForm.vue'
import McpToolReview from '../../components/mcp/McpToolReview.vue'
import type { McpNewServer, McpServerView, McpToolListing } from '../../types/mcp'

const ModalConfirm = defineAsyncComponent(() => import('../../components/ModalConfirm.vue'))

const toast = useToast()
const overlay = useOverlay()
const { openAuthModal, isAuthenticated } = useFirebaseAuth()
const { servers, limits, loading, loaded, unauthorized, loadError, fetchServers, addServer, updateServer, removeServer, listTools, approveTools } = useMcpServers()

onMounted(fetchServers)
watch(isAuthenticated, fetchServers)

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

const approvedTotal = computed(() => servers.value.reduce((n, s) => n + s.approved.length, 0))
const atLimit = computed(() => servers.value.length >= limits.value.servers)

// ---- Add a server ----
const formOpen = ref(false)
const adding = ref(false)
const addError = ref<string | null>(null)

function openAdd() {
  if (unauthorized.value) return openAuthModal()
  addError.value = null
  formOpen.value = true
}

async function submitAdd(input: McpNewServer) {
  adding.value = true
  addError.value = null
  try {
    const server = await addServer(input)
    formOpen.value = false
    toast.add({ title: 'Server added', description: 'Now review its tools and approve the ones you want.', icon: 'i-lucide-check', color: 'success' })
    await review(server)
  } catch (err: any) {
    addError.value = errorMessage(err, 'Could not add the server. Try again.')
  } finally {
    adding.value = false
  }
}

// ---- Review and approve tools ----
const reviewOpen = ref(false)
const reviewing = ref<McpServerView | null>(null)
const reviewTools = ref<McpToolListing[]>([])
const reviewLoading = ref(false)
const reviewError = ref<string | null>(null)
const savingApprovals = ref(false)

async function review(server: McpServerView) {
  reviewing.value = server
  reviewTools.value = []
  reviewError.value = null
  reviewOpen.value = true
  reviewLoading.value = true
  try {
    reviewTools.value = await listTools(server.id)
  } catch (err: any) {
    reviewError.value = errorMessage(err, 'Could not reach the server.')
  } finally {
    reviewLoading.value = false
  }
}

async function saveApprovals(names: string[]) {
  if (!reviewing.value) return
  savingApprovals.value = true
  reviewError.value = null
  try {
    await approveTools(reviewing.value.id, names)
    reviewOpen.value = false
    toast.add({ title: names.length ? `${names.length} ${names.length === 1 ? 'tool' : 'tools'} approved` : 'No tools approved', icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not save approvals', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    savingApprovals.value = false
  }
}

// ---- Switch off, remove ----
async function toggle(server: McpServerView, enabled: boolean) {
  try {
    await updateServer(server.id, { enabled })
  } catch (err: any) {
    toast.add({ title: 'Could not update the server', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const deleteModal = overlay.create(ModalConfirm)
async function remove(server: McpServerView) {
  const confirmed = await deleteModal.open({
    title: `Remove "${server.name}"?`,
    description: 'Its stored token and approvals are deleted. Agents that used its tools lose them.',
    confirmLabel: 'Remove',
    color: 'error'
  }).result
  if (!confirmed) return
  try {
    await removeServer(server.id)
    toast.add({ title: 'Server removed', icon: 'i-lucide-trash-2', color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not remove the server', description: errorMessage(err, 'Try again.'), icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

const host = (url: string) => { try { return new URL(url).host } catch { return url } }
const isEmpty = computed(() => loaded.value && !loading.value && !unauthorized.value && !loadError.value && servers.value.length === 0)

const PILLARS = [
  { icon: 'i-lucide-plug', title: 'Bring your own tools', detail: 'Connect any server that speaks MCP, such as a company tool or a developer service.' },
  { icon: 'i-lucide-list-checks', title: 'You approve every tool', detail: 'You read what each tool does and pick the ones OpenLobs may use. Nothing is on by default.' },
  { icon: 'i-lucide-shield-check', title: 'Watched for changes', detail: 'If an approved tool changes later, it stops working until you look at it again.' }
]
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <RouterLink to="/integrations" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-default mb-6 focus-visible:outline-2 focus-visible:outline-primary rounded">
        <UIcon name="i-lucide-arrow-left" class="size-4" />
        Integrations
      </RouterLink>

      <div class="flex items-start justify-between gap-4 mb-10">
        <div>
          <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">MCP servers</h1>
          <p class="text-muted text-base md:text-lg">Give OpenLobs extra tools from servers you trust.</p>
        </div>
        <UButton v-if="!unauthorized" label="Add server" icon="i-lucide-plus" color="neutral" class="shrink-0" :disabled="atLimit" @click="openAdd" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
        <div v-for="pillar in PILLARS" :key="pillar.title" class="rounded-2xl border border-default bg-elevated/40 p-4">
          <div class="size-8 rounded-lg border border-default bg-default shadow-sm flex items-center justify-center mb-3">
            <UIcon :name="pillar.icon" class="size-4 text-primary" />
          </div>
          <h3 class="text-sm font-semibold text-highlighted mb-1">{{ pillar.title }}</h3>
          <p class="text-xs text-muted leading-relaxed">{{ pillar.detail }}</p>
        </div>
      </div>

      <div v-if="unauthorized" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to connect MCP servers</h2>
        <p class="text-sm text-muted mb-5">Servers and their tokens belong to your account.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <div v-else-if="loadError" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-cloud-off" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Could not load your servers</h2>
        <p class="text-sm text-muted mb-5">{{ loadError }}</p>
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchServers" />
      </div>

      <div v-else-if="!loaded" class="py-12 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="isEmpty" class="rounded-2xl border border-dashed border-default p-10 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-plug" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">No servers yet</h2>
        <p class="text-sm text-muted mb-5">Add a server's address, read its tools, and approve the ones you want.</p>
        <UButton label="Add server" icon="i-lucide-plus" color="neutral" @click="openAdd" />
      </div>

      <div v-else class="flex flex-col gap-4">
        <div v-for="server in servers" :key="server.id" class="rounded-2xl border border-default bg-default p-5 hover:shadow-md transition-shadow">
          <div class="flex items-start gap-4">
            <div class="p-2.5 rounded-xl border border-default shadow-sm bg-default shrink-0">
              <UIcon name="i-lucide-plug" class="size-5 text-primary" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 mb-0.5">
                <h3 class="text-sm font-semibold text-highlighted truncate">{{ server.name }}</h3>
                <UBadge v-if="!server.enabled" label="Switched off" color="neutral" variant="subtle" size="sm" />
                <UBadge v-else-if="server.approved.length" :label="`${server.approved.length} ${server.approved.length === 1 ? 'tool' : 'tools'} approved`" color="success" variant="subtle" size="sm" />
                <UBadge v-else label="No tools approved" color="neutral" variant="subtle" size="sm" />
              </div>
              <p class="text-xs text-muted truncate">{{ host(server.url) }}<span v-if="server.hasToken"> · token saved</span></p>
            </div>
            <USwitch :model-value="server.enabled" :aria-label="`Use ${server.name}`" @update:model-value="toggle(server, Boolean($event))" />
          </div>

          <UAlert v-if="server.driftNote" class="mt-4" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="A tool changed" :description="`${server.driftNote} Review it before it can be used again.`" />
          <UAlert v-else-if="server.lastError" class="mt-4" color="error" variant="subtle" icon="i-lucide-cloud-off" :description="server.lastError" />

          <div v-if="server.approved.length" class="flex flex-wrap gap-1.5 mt-4">
            <UBadge v-for="t in server.approved" :key="t.name" :label="t.name" color="neutral" variant="subtle" size="sm" class="font-mono max-w-full truncate" />
          </div>

          <div class="flex items-center gap-2 mt-4 pt-4 border-t border-default">
            <UButton label="Review tools" icon="i-lucide-list-checks" size="sm" color="neutral" @click="review(server)" />
            <UButton label="Remove" icon="i-lucide-trash" size="sm" color="error" variant="ghost" class="ml-auto" @click="remove(server)" />
          </div>
        </div>
      </div>

      <p v-if="loaded && servers.length" class="text-xs text-muted mt-4">
        {{ servers.length }} of {{ limits.servers }} servers · {{ approvedTotal }} of {{ limits.approvedTotal }} tools approved
      </p>
    </div>

    <McpServerForm v-model:open="formOpen" :saving="adding" :error="addError" @save="submitAdd" />
    <McpToolReview
      v-model:open="reviewOpen"
      :server="reviewing"
      :tools="reviewTools"
      :loading="reviewLoading"
      :saving="savingApprovals"
      :error="reviewError"
      :max-per-server="limits.approvedPerServer"
      @save="saveApprovals"
      @retry="reviewing && review(reviewing)"
    />
  </div>
</template>
