<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import Creature from '../../agents/Creature.vue'
import { specialistById } from '../../../../shared/specialists'

// A trace line, like every other tool: the agent's avatar, its name, and the job or the report when opened. The words
// the person reads ("I am putting Chameleon on this", "Here is what it found") come from OpenLobs in the reply itself.
const props = defineProps<{ part: any, kind: 'ask' | 'report' }>()

const streaming = computed(() => isToolStreaming(props.part) || (props.kind === 'ask' && !props.part.output && props.part.state !== 'output-error'))
const specialist = computed(() => specialistById(props.part.output?.specialist ?? props.part.input?.specialist))
const failed = computed(() => props.part.state === 'output-error' || props.part.output?.status === 'failed')
const body = computed(() => (props.kind === 'ask' ? String(props.part.input?.brief ?? '') : String(props.part.output?.summary ?? props.part.input?.summary ?? '')))
const text = computed(() => {
  const s = specialist.value
  if (!s) return props.kind === 'ask' ? 'Using an agent' : 'Agent finished'
  if (failed.value) return props.kind === 'ask' ? `${s.name} was not available` : `${s.name} could not finish`
  return props.kind === 'ask' ? `${s.name} is on it` : `${s.name} finished`
})
const suffix = computed(() => (props.kind === 'ask' && specialist.value ? specialist.value.role : undefined))
</script>

<template>
  <div class="relative min-w-0">
    <Creature
      v-if="specialist"
      :species="specialist.id"
      :mood="failed ? 'idle' : kind === 'report' ? 'done' : streaming ? 'working' : 'idle'"
      :size="20"
      :animate="streaming"
      class="pointer-events-none absolute left-0 top-1"
    />
    <UChatTool
      :text="text"
      :suffix="suffix"
      :streaming="streaming"
      chevron="trailing"
      :ui="{ trigger: 'pl-7' }"
      class="min-w-0 max-w-full"
    >
      <p
        v-if="body"
        class="ml-7 border-l border-default pl-3 text-xs leading-relaxed text-muted whitespace-pre-wrap"
      >
        {{ body }}
      </p>
    </UChatTool>
  </div>
</template>
