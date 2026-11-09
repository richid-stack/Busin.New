<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useModelProviders } from '../../composables/useModelProviders'
import type { ProviderDetail, ProviderRow } from '../../types/models'
import type { ListedModel } from '../../../shared/modelProviders'

const props = defineProps<{ open: boolean, provider: ProviderRow | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const LIMITS = { enabled: 60, manual: 20 }

const store = useModelProviders()
const toast = useToast()
const open = computed({ get: () => props.open, set: v => emit('update:open', v) })

const key = ref('')
const baseUrl = ref('')
const showAddress = ref(false)
const detail = ref<ProviderDetail | null>(null)
const enabled = ref<Set<string>>(new Set())
const manual = ref<string[]>([])
const search = ref('')
const typed = ref('')
const busy = ref<'' | 'connect' | 'refresh' | 'save' | 'load'>('')
const error = ref<string | null>(null)
const replacingKey = ref(false)

const errorMessage = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || err?.message || fallback

function adopt(d: ProviderDetail) {
  detail.value = d
  enabled.value = new Set(d.enabled)
  manual.value = [...d.manual]
  replacingKey.value = false
  key.value = ''
}

// Each time the dialog opens, start from what is saved. A late answer for an earlier opening is dropped.
let opening = 0
watch(() => [props.open, props.provider?.id] as const, async ([isOpen]) => {
  if (!isOpen || !props.provider) return
  const mine = ++opening
  key.value = ''
  search.value = ''
  typed.value = ''
  error.value = null
  detail.value = null
  replacingKey.value = false
  baseUrl.value = props.provider.baseUrl || (props.provider.custom ? '' : props.provider.defaultBaseUrl)
  showAddress.value = props.provider.custom
  if (!props.provider.connected) return
  busy.value = 'load'
  try {
    const d = await store.detail(props.provider.id)
    if (mine === opening) adopt(d)
  } catch (err: any) {
    if (mine === opening) error.value = errorMessage(err, 'Could not load this provider.')
  } finally {
    if (mine === opening) busy.value = ''
  }
}, { immediate: true })

const isDefaultAddress = computed(() => !props.provider || baseUrl.value.trim().replace(/\/+$/, '') === props.provider.defaultBaseUrl)
const canConnect = computed(() => key.value.replace(/\s/g, '').length >= 8 && (!props.provider?.custom || /^https:\/\/\S+$/i.test(baseUrl.value.trim())) && !busy.value)
const showKeyStep = computed(() => !detail.value || replacingKey.value)

async function connect() {
  if (!props.provider || !canConnect.value) return
  busy.value = 'connect'
  error.value = null
  try {
    // The built-in address is left out so the server keeps using the provider's own.
    adopt(await store.connect(props.provider.id, key.value, props.provider.custom || !isDefaultAddress.value ? baseUrl.value.trim() : ''))
  } catch (err: any) {
    error.value = errorMessage(err, 'Could not get the models. Check the key and try again.')
  } finally {
    busy.value = ''
  }
}

async function refresh() {
  if (!props.provider) return
  busy.value = 'refresh'
  error.value = null
  try {
    adopt(await store.refresh(props.provider.id))
    toast.add({ title: 'Models updated', description: `${detail.value?.models.length ?? 0} available now.`, icon: 'i-lucide-check', color: 'success' })
  } catch (err: any) {
    error.value = errorMessage(err, 'Could not get the models.')
  } finally {
    busy.value = ''
  }
}

const rows = computed<ListedModel[]>(() => {
  if (!detail.value) return []
  const listed = new Set(detail.value.models.map(m => m.id))
  const extra: ListedModel[] = manual.value.filter(id => !listed.has(id)).map(id => ({ id, label: id }))
  return [...extra, ...detail.value.models]
})
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
})
const atLimit = computed(() => enabled.value.size >= LIMITS.enabled)

function toggle(id: string, on: boolean) {
  const next = new Set(enabled.value)
  if (on) next.add(id)
  else next.delete(id)
  enabled.value = next
}

const typedOk = computed(() => /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(typed.value.trim()) && typed.value.trim().length <= 200)
function addTyped() {
  const id = typed.value.trim()
  if (!typedOk.value || manual.value.length >= LIMITS.manual) return
  if (!manual.value.includes(id) && !detail.value?.models.some(m => m.id === id)) manual.value = [...manual.value, id]
  toggle(id, true)
  typed.value = ''
}

const dirty = computed(() => {
  if (!detail.value) return false
  const before = new Set(detail.value.enabled)
  return before.size !== enabled.value.size || [...enabled.value].some(id => !before.has(id)) || manual.value.length !== detail.value.manual.length
})

async function save() {
  if (!props.provider || !detail.value) return
  busy.value = 'save'
  error.value = null
  try {
    // A name typed in but switched off again is simply forgotten.
    const keepManual = manual.value.filter(id => enabled.value.has(id) || detail.value!.manual.includes(id) && enabled.value.has(id))
    await store.saveSelection(props.provider.id, [...enabled.value], keepManual)
    toast.add({ title: `${props.provider.name} saved`, description: `${enabled.value.size} ${enabled.value.size === 1 ? 'model' : 'models'} in your model list.`, icon: 'i-lucide-check', color: 'success' })
    open.value = false
  } catch (err: any) {
    error.value = errorMessage(err, 'Could not save.')
  } finally {
    busy.value = ''
  }
}

const compact = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))
const dateLabel = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '' } }
</script>

<template>
  <UModal
    v-model:open="open"
    :title="provider ? (provider.connected && !replacingKey ? provider.name : `Connect ${provider.name}`) : 'Connect a provider'"
    description="Your key is checked by asking the provider for its models. It is stored encrypted and never shown again."
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <div v-if="provider" class="flex flex-col gap-4">
        <div class="flex items-start gap-3">
          <BrandMark :icon="provider.icon" :name="provider.name" size="lg" />
          <p class="text-sm text-muted">
            {{ provider.keyHelp }}
            <a v-if="provider.keyUrl" :href="provider.keyUrl" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2">Get a key</a>
          </p>
        </div>

        <div v-if="busy === 'load'" class="py-8 flex justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
        </div>

        <form v-else-if="showKeyStep" class="flex flex-col gap-4" @submit.prevent="connect">
          <UFormField v-if="provider.custom" label="Service address" description="The base address, for example https://api.example.com/v1. It must be public and start with https://.">
            <UInput v-model="baseUrl" placeholder="https://api.example.com/v1" class="w-full" autocomplete="off" inputmode="url" />
          </UFormField>
          <UFormField label="API key">
            <UInput v-model="key" type="password" placeholder="Paste your key" class="w-full" autocomplete="off" />
          </UFormField>
          <div v-if="!provider.custom">
            <button type="button" class="text-xs text-dimmed hover:text-default inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-primary rounded" :aria-expanded="showAddress" @click="showAddress = !showAddress">
              <UIcon :name="showAddress ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
              Advanced
            </button>
            <UFormField v-if="showAddress" class="mt-3" label="Address" description="Only change this for another region or a proxy. It must be public and start with https://.">
              <UInput v-model="baseUrl" class="w-full" autocomplete="off" inputmode="url" />
            </UFormField>
          </div>
          <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
          <div class="flex items-center justify-end gap-2">
            <UButton v-if="replacingKey" label="Cancel" color="neutral" variant="ghost" @click="replacingKey = false; error = null" />
            <UButton type="submit" label="Get models" icon="i-lucide-download" color="neutral" :loading="busy === 'connect'" :disabled="!canConnect" />
          </div>
        </form>

        <template v-else-if="detail">
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{{ detail.models.length }} {{ detail.models.length === 1 ? 'model' : 'models' }} available<span v-if="detail.fetchedAt"> · checked {{ dateLabel(detail.fetchedAt) }}</span></span>
            <span class="ml-auto flex gap-1">
              <UButton v-if="provider.listsModels" label="Refresh" icon="i-lucide-refresh-cw" size="xs" color="neutral" variant="ghost" :loading="busy === 'refresh'" @click="refresh" />
              <UButton label="Replace key" icon="i-lucide-key-round" size="xs" color="neutral" variant="ghost" @click="replacingKey = true; error = null" />
            </span>
          </div>

          <UInput v-model="search" icon="i-lucide-search" placeholder="Search models" class="w-full" autocomplete="off" aria-label="Search models" />

          <ul class="max-h-80 overflow-y-auto divide-y divide-default rounded-xl border border-default" aria-label="Models">
            <li v-for="m in shown" :key="m.id">
              <label class="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-elevated/50">
                <UCheckbox :model-value="enabled.has(m.id)" :disabled="!enabled.has(m.id) && atLimit" class="mt-0.5" :aria-label="`Use ${m.label}`" @update:model-value="toggle(m.id, Boolean($event))" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm text-highlighted truncate">{{ m.label }}</span>
                  <span v-if="m.label !== m.id" class="block text-xs text-dimmed font-mono truncate">{{ m.id }}</span>
                  <span v-if="m.context || m.tools || m.vision || m.reasoning || m.free" class="flex flex-wrap gap-1 mt-1">
                    <UBadge v-if="m.context" :label="`${compact(m.context)} context`" color="neutral" variant="subtle" size="sm" />
                    <UBadge v-if="m.tools" label="Tools" color="neutral" variant="subtle" size="sm" />
                    <UBadge v-if="m.vision" label="Images" color="neutral" variant="subtle" size="sm" />
                    <UBadge v-if="m.reasoning" label="Reasoning" color="neutral" variant="subtle" size="sm" />
                    <UBadge v-if="m.free" label="Free" color="success" variant="subtle" size="sm" />
                  </span>
                </span>
              </label>
            </li>
            <li v-if="!shown.length" class="px-3 py-6 text-center text-sm text-muted">
              {{ rows.length ? 'No model matches that search.' : 'This provider returned no chat models. Add one by name below.' }}
            </li>
          </ul>

          <form class="flex items-center gap-2" @submit.prevent="addTyped">
            <UInput v-model="typed" placeholder="Not listed? Type a model name" class="flex-1" autocomplete="off" aria-label="Model name" />
            <UButton type="submit" label="Add" color="neutral" variant="subtle" :disabled="!typedOk || manual.length >= LIMITS.manual" />
          </form>

          <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />

          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">{{ enabled.size }} of {{ LIMITS.enabled }} switched on</span>
            <UButton label="Save" color="neutral" class="ml-auto" :loading="busy === 'save'" :disabled="!dirty" @click="save" />
          </div>
        </template>

        <UAlert v-if="error && !showKeyStep && !detail" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
      </div>
    </template>
  </UModal>
</template>
