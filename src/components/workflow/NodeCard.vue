<script setup lang="ts">
import { computed, inject } from 'vue'
import type { Ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { STATUS_META, logicKind } from '../../utils/workflowGraph'
import type { NodeRuntime } from '../../utils/workflowGraph'

const props = defineProps<{
  id: string
  kind: 'trigger' | 'agent' | 'action' | 'logic' | 'approval'
  data: Record<string, any>
  selected?: boolean
}>()

// Run state lives outside the persisted node data so it never reaches autosave or undo history.
const runtime = inject<Ref<Record<string, NodeRuntime>> | null>('workflowRuntime', null)
const run = computed(() => runtime?.value?.[props.id])
const status = computed(() => run.value?.status)
const meta = computed(() => (status.value ? STATUS_META[status.value] : null))

const KINDS = {
  trigger: { label: 'Trigger', icon: 'i-lucide-zap', labelClass: 'text-muted' },
  agent: { label: 'AI Agent', icon: 'i-lucide-sparkles', labelClass: 'text-primary' },
  action: { label: 'Action', icon: 'i-lucide-layers', labelClass: 'text-muted' },
  logic: { label: 'Logic', icon: 'i-lucide-git-branch', labelClass: 'text-muted' },
  approval: { label: 'Approval', icon: 'i-lucide-user-check', labelClass: 'text-warning' }
} as const

const kindMeta = computed(() => KINDS[props.kind])
const hasInput = computed(() => props.kind !== 'trigger')
const routesErrors = computed(() => props.data.settings?.onError === 'route')
const isBranching = computed(() => props.kind === 'logic' && logicKind({ id: props.id, data: props.data }) === 'if-else')

const borderClass = computed(() => {
  switch (status.value) {
    case 'completed': return 'border-success/50 ring-1 ring-success/10'
    case 'failed':
    case 'rejected': return 'border-error/50 ring-1 ring-error/10'
    case 'auth_required':
    case 'waiting_approval': return 'border-warning/50 ring-1 ring-warning/10'
    case 'running': return 'border-primary ring-1 ring-primary/20 animate-pulse'
    default: return props.selected ? 'border-primary ring-2 ring-primary/25' : 'border-default hover:border-primary/40'
  }
})

const statusTextClass = computed(() => {
  switch (meta.value?.color) {
    case 'success': return 'text-success'
    case 'error': return 'text-error'
    case 'warning': return 'text-warning'
    case 'info': return 'text-primary'
    default: return 'text-muted'
  }
})
</script>

<template>
  <div
    class="bg-elevated border rounded-xl p-3.5 min-w-[220px] transition-colors cursor-pointer"
    :class="borderClass"
  >
    <div class="flex items-center justify-between mb-2 pb-2 border-b border-default/50">
      <span
        class="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
        :class="kindMeta.labelClass"
      >
        <UIcon :name="kindMeta.icon" class="size-3" /> {{ kindMeta.label }}
      </span>
      <div
        v-if="meta"
        class="flex items-center gap-1 text-[9px] font-mono"
        :class="statusTextClass"
        :title="run?.message || meta.label"
      >
        <UIcon
          :name="meta.icon"
          class="size-3"
          :class="{ 'animate-spin': status === 'running' }"
        />
        <span v-if="run?.durationMs">{{ run.durationMs }}ms</span>
      </div>
    </div>

    <Handle
      v-if="hasInput"
      type="target"
      :position="Position.Left"
      class="!bg-default !w-2.5 !h-2.5"
    />

    <div class="flex items-center gap-2.5">
      <UIcon
        :name="data.icon || 'i-lucide-box'"
        class="size-4 shrink-0"
        :class="kind === 'agent' ? [data.color, 'opacity-80'] : 'text-default opacity-80'"
      />
      <div class="min-w-0">
        <h4 class="font-medium text-xs text-default truncate">{{ data.title }}</h4>
        <p class="text-[10px] text-muted truncate">{{ data.subtitle }}</p>
      </div>
    </div>

    <template v-if="isBranching">
      <Handle
        id="true"
        type="source"
        :position="Position.Right"
        class="!bg-success !w-2.5 !h-2.5 !top-1/3"
      />
      <div class="absolute -right-6 top-1/3 -translate-y-1/2 text-[9px] font-bold text-success">TRUE</div>
      <Handle
        id="false"
        type="source"
        :position="Position.Right"
        class="!bg-error !w-2.5 !h-2.5 !top-2/3"
      />
      <div class="absolute -right-7 top-2/3 -translate-y-1/2 text-[9px] font-bold text-error">FALSE</div>
    </template>
    <Handle
      v-else
      type="source"
      :position="Position.Right"
      class="!bg-primary !w-2.5 !h-2.5"
    />

    <template v-if="routesErrors">
      <Handle
        id="error"
        type="source"
        :position="Position.Bottom"
        class="!bg-error !w-2.5 !h-2.5"
      />
      <div class="absolute left-1/2 -bottom-5 -translate-x-1/2 text-[9px] font-bold text-error pointer-events-none">ERROR</div>
    </template>
  </div>
</template>
