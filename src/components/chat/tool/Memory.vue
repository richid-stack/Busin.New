<script setup lang="ts">
import { computed } from 'vue'
import { getToolName } from 'ai'
import { isToolStreaming } from '@nuxt/ui/utils/ai'

const props = defineProps<{ part: any }>()

const streaming = computed(() => isToolStreaming(props.part))
const forgetting = computed(() => getToolName(props.part) === 'forget_memory')
const out = computed(() => (props.part.output && typeof props.part.output === 'object' ? props.part.output as Record<string, any> : null))

const text = computed(() => {
  if (streaming.value) return forgetting.value ? 'Forgetting...' : 'Remembering...'
  switch (out.value?.status) {
    case 'saved': return out.value?.existed ? 'Already remembered' : 'Remembered'
    case 'forgotten': return 'Forgot'
    case 'ambiguous': return 'Needs your choice'
    default: return forgetting.value ? 'Could not forget' : 'Could not save to memory'
  }
})
const suffix = computed(() => out.value?.text || (typeof props.part.input?.text === 'string' ? props.part.input.text : props.part.input?.query) || undefined)
</script>

<template>
  <UChatTool
    :text="text"
    :suffix="suffix"
    :streaming="streaming"
    icon="i-lucide-brain"
  >
    <p class="text-xs text-muted">
      <RouterLink to="/memory" class="underline underline-offset-2 hover:text-highlighted">Manage your memory</RouterLink>
    </p>
  </UChatTool>
</template>
