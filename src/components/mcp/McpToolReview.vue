<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { McpServerView, McpToolListing } from '../../types/mcp'

const props = defineProps<{
  open: boolean
  server: McpServerView | null
  tools: McpToolListing[]
  loading: boolean
  saving: boolean
  error: string | null
  maxPerServer: number
}>()
const emit = defineEmits<{ 'update:open': [boolean], 'save': [string[]], 'retry': [] }>()

const selected = ref<Set<string>>(new Set())
const expanded = ref<string | null>(null)

// Start from what is approved and still matches; a changed tool must be ticked again on purpose.
watch(() => [props.open, props.tools] as const, () => {
  selected.value = new Set(props.tools.filter(t => t.status === 'approved').map(t => t.name))
  expanded.value = null
}, { immediate: true })

const open = computed({ get: () => props.open, set: v => emit('update:open', v) })
const atLimit = computed(() => selected.value.size >= props.maxPerServer)

function toggle(name: string, on: boolean) {
  const next = new Set(selected.value)
  if (on) next.add(name)
  else next.delete(name)
  selected.value = next
}

const params = (t: McpToolListing) => Object.entries(t.inputSchema?.properties ?? {}).map(([name, p]) => ({
  name,
  type: p?.type ?? 'any',
  description: p?.description ?? '',
  required: Boolean(t.inputSchema?.required?.includes(name))
}))

const STATUS = {
  approved: { label: 'Approved', color: 'success' as const },
  changed: { label: 'Changed since approval', color: 'warning' as const },
  new: { label: 'New', color: 'neutral' as const }
}
</script>

<template>
  <UModal v-model:open="open" :title="server ? `Tools from ${server.name}` : 'Tools'" description="Pick the tools OpenLobs may use. Read what each one says it does first." :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div v-if="loading" class="py-12 flex flex-col items-center gap-3 text-sm text-muted">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" />
        Connecting to the server…
      </div>

      <div v-else-if="error" class="rounded-xl border border-default bg-elevated/50 p-6 text-center">
        <UIcon name="i-lucide-cloud-off" class="size-5 text-muted mb-2" />
        <p class="text-sm text-highlighted font-medium mb-1">Could not read the server's tools</p>
        <p class="text-sm text-muted mb-4">{{ error }}</p>
        <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" @click="emit('retry')" />
      </div>

      <div v-else-if="!tools.length" class="py-10 text-center text-sm text-muted">This server does not offer any tools we can use.</div>

      <div v-else class="flex flex-col gap-2">
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="These tools run on someone else's server"
          description="Only approve ones you trust. If a tool's description or inputs change later, it stops working until you approve it again."
          class="mb-2"
        />
        <div
          v-for="t in tools"
          :key="t.name"
          class="rounded-xl border bg-default p-3.5 transition-colors"
          :class="t.status === 'changed' ? 'border-warning/60' : 'border-default'"
        >
          <div class="flex items-start gap-3">
            <UCheckbox
              :model-value="selected.has(t.name)"
              :disabled="!selected.has(t.name) && atLimit"
              :aria-label="`Approve ${t.name}`"
              class="mt-0.5"
              @update:model-value="toggle(t.name, Boolean($event))"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <span class="text-sm font-medium text-highlighted font-mono break-all">{{ t.name }}</span>
                <UBadge :label="STATUS[t.status].label" :color="STATUS[t.status].color" variant="subtle" size="sm" />
                <UBadge v-if="t.annotations?.destructiveHint" label="Says it can change or delete things" color="error" variant="subtle" size="sm" />
                <UBadge v-else-if="t.annotations?.readOnlyHint" label="Says it only reads" color="neutral" variant="subtle" size="sm" />
              </div>
              <p class="text-xs text-muted leading-relaxed whitespace-pre-line">{{ t.description || 'No description given.' }}</p>
              <button
                type="button"
                class="mt-2 text-xs text-dimmed hover:text-default inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-primary rounded"
                :aria-expanded="expanded === t.name"
                @click="expanded = expanded === t.name ? null : t.name"
              >
                <UIcon :name="expanded === t.name ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
                Inputs ({{ params(t).length }})
              </button>
              <ul v-if="expanded === t.name" class="mt-2 space-y-1.5 border-l border-default pl-3">
                <li v-if="!params(t).length" class="text-xs text-muted">Takes no inputs.</li>
                <li v-for="p in params(t)" :key="p.name" class="text-xs">
                  <span class="font-mono text-default">{{ p.name }}</span>
                  <span class="text-dimmed"> · {{ p.type }}{{ p.required ? ' · required' : '' }}</span>
                  <p v-if="p.description" class="text-muted">{{ p.description }}</p>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <p v-if="atLimit" class="text-xs text-muted">You can approve up to {{ maxPerServer }} tools per server.</p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <span class="text-xs text-muted">{{ selected.size }} selected</span>
        <div class="flex gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Save approvals" icon="i-lucide-check" color="neutral" :loading="saving" :disabled="loading || Boolean(error)" @click="emit('save', [...selected])" />
        </div>
      </div>
    </template>
  </UModal>
</template>
