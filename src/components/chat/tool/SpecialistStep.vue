<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import Creature from '../../agents/Creature.vue'
import StatusChip from '../../tasks/StatusChip.vue'
import { specialistById } from '../../../../shared/specialists'

// The two rows that say plainly OpenLobs is using one of its own specialists: the lead asking, and the specialist reporting back.
const props = defineProps<{ part: any, kind: 'ask' | 'report' }>()

const streaming = computed(() => isToolStreaming(props.part))
const specialist = computed(() => specialistById(props.part.output?.specialist ?? props.part.input?.specialist))
const failed = computed(() => props.part.state === 'output-error' || props.part.output?.status === 'failed')
const text = computed(() => (props.kind === 'ask' ? String(props.part.input?.brief ?? '') : String(props.part.output?.summary ?? props.part.input?.summary ?? '')))
const mood = computed(() => (failed.value ? 'idle' : props.kind === 'report' ? 'done' : streaming.value || props.part.state === 'input-available' ? 'working' : 'idle'))
const heading = computed(() => {
  const s = specialist.value
  if (!s) return props.kind === 'ask' ? 'Asking a specialist' : 'A specialist reported back'
  if (failed.value) return props.kind === 'ask' ? `Could not ask ${s.name}` : `${s.name} could not report`
  return props.kind === 'ask' ? `Asked ${s.name}, the ${s.role}` : `${s.name} reported back`
})
</script>

<template>
  <div
    v-if="specialist"
    class="my-2 flex items-start gap-3 min-w-0"
  >
    <div class="size-9 shrink-0 rounded-lg border border-default bg-elevated/60 flex items-center justify-center">
      <Creature
        :species="specialist.id"
        :mood="mood"
        :size="28"
        :animate="mood === 'working'"
      />
    </div>
    <div class="min-w-0 flex-1">
      <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-highlighted">
        <span>{{ heading }}</span>
        <StatusChip
          label="OpenLobs specialist"
          tone="quiet"
        />
      </p>
      <details
        v-if="text"
        class="group mt-1"
      >
        <summary class="cursor-pointer list-none text-xs text-muted hover:text-default">
          <span class="line-clamp-2 group-open:line-clamp-none">{{ text }}</span>
        </summary>
      </details>
    </div>
  </div>
</template>
