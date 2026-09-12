<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import type { CalculatorUIToolInvocation } from '../../../../server/utils/tools/calculator'

const props = defineProps<{
  invocation: CalculatorUIToolInvocation
}>()

const streaming = computed(() => isToolStreaming(props.invocation))
const expression = computed(() => props.invocation.output?.expression || props.invocation.input?.expression || '')
const label = computed(() => props.invocation.output?.label || props.invocation.input?.label)
const result = computed(() => props.invocation.output?.result)
</script>

<template>
  <UChatTool
    :text="streaming ? 'Evaluating math...' : 'Calculated'"
    :suffix="label || expression"
    :streaming="streaming"
    icon="i-lucide-calculator"
    chevron="leading"
  >
    <div class="flex items-center justify-between p-2.5 border border-default rounded-md bg-elevated/40 text-xs sm:text-sm font-mono">
      <span class="text-muted truncate mr-2">{{ expression }}</span>
      <span class="font-semibold text-highlighted shrink-0">= {{ result }}</span>
    </div>
  </UChatTool>
</template>
