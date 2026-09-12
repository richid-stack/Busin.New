<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import type { PlanUIToolInvocation } from '../../../../server/utils/tools/plan'

const props = defineProps<{
  invocation: PlanUIToolInvocation
}>()

const streaming = computed(() => isToolStreaming(props.invocation))
const title = computed(() => props.invocation.output?.title || props.invocation.input?.title || 'Execution plan')
const steps = computed(() => props.invocation.output?.steps || props.invocation.input?.steps || [])
const summary = computed(() => props.invocation.output?.summary)
</script>

<template>
  <UChatTool
    :text="streaming ? 'Planning workflow...' : 'Workflow plan'"
    :suffix="title"
    :streaming="streaming"
    icon="i-lucide-list-checks"
    chevron="leading"
  >
    <div
      v-if="steps.length"
      class="flex flex-col gap-2 p-3 border border-default rounded-lg bg-elevated/40"
    >
      <div
        v-for="(step, index) in steps"
        :key="index"
        class="flex items-start gap-2.5 text-sm"
      >
        <template v-if="step">
          <UIcon
            v-if="step.status === 'completed'"
            name="i-lucide-check-circle-2"
            class="size-4 text-success shrink-0 mt-0.5"
          />
          <UIcon
            v-else-if="step.status === 'in_progress'"
            name="i-lucide-loader-circle"
            class="size-4 text-primary animate-spin shrink-0 mt-0.5"
          />
          <UIcon
            v-else
            name="i-lucide-circle"
            class="size-4 text-dimmed shrink-0 mt-0.5"
          />
          <span
            class="text-default leading-relaxed"
            :class="step.status === 'completed' && 'text-muted'"
          >
            {{ step.task }}
          </span>
        </template>
      </div>

      <p
        v-if="summary"
        class="text-xs text-muted pt-2 border-t border-default/60 mt-1"
      >
        {{ summary }}
      </p>
    </div>
  </UChatTool>
</template>
