<script setup lang="ts">
import VariablePicker from '../VariablePicker.vue'

defineProps<{
  config: Record<string, any>
  variables: Array<{ group: string, label: string, value: string, icon?: string }>
}>()
const emit = defineEmits<{ update: [patch: Record<string, any>] }>()
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Page address" size="sm" help="The text of the page becomes this step's output (content, title, url).">
      <VariablePicker
        :model-value="config.url || ''"
        :variables="variables"
        placeholder="https://example.com/pricing"
        @update:model-value="emit('update', { url: $event })"
      />
    </UFormField>
    <UFormField label="Most characters to keep" size="sm" help="Between 500 and 30,000. Shorter keeps later AI steps cheaper.">
      <UInput
        :model-value="config.maxChars ?? 8000"
        type="number"
        :min="500"
        :max="30000"
        size="sm"
        class="w-full"
        @update:model-value="emit('update', { maxChars: Math.min(30000, Math.max(500, Number($event) || 8000)) })"
      />
    </UFormField>
  </div>
</template>
