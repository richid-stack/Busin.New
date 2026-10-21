<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'

const props = defineProps<{
  invocation: any
}>()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output)

</script>

<template>
  <UChatTool
    :text="streaming ? 'Building workflow pipeline...' : (output?.success ? 'Workflow created' : 'Workflow creation failed')"
    :suffix="props.invocation.input?.title || 'Automation Workflow'"
    :streaming="streaming"
    icon="i-lucide-workflow"
    chevron="leading"
  >
    <div v-if="output && output.success" class="p-4 border border-emerald-500/20 bg-emerald-500/5 rounded-xl flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <div class="p-2.5 bg-emerald-500/10 rounded-lg text-emerald-600 dark:text-emerald-400">
          <UIcon name="i-lucide-check-circle-2" class="size-5" />
        </div>
        <div>
          <h4 class="font-semibold text-default text-sm">{{ output.title || props.invocation.input?.title }}</h4>
          <p class="text-xs text-muted">{{ output.message }}</p>
        </div>
      </div>
      
      <div class="flex items-center gap-2 mt-1">
        <UButton
          v-if="output.studioUrl"
          :to="output.studioUrl"
          color="primary"
          variant="solid"
          size="sm"
          icon="i-lucide-external-link"
          label="Open in Workflow Studio"
          class="w-full justify-center"
        />
      </div>
    </div>
    
    <div v-else-if="output && !output.success" class="p-3 border border-error/20 bg-error/5 rounded-md text-error text-xs">
      <div class="font-semibold mb-1">Failed to build workflow</div>
      <div class="opacity-80">{{ output.error }}</div>
    </div>
  </UChatTool>
</template>
