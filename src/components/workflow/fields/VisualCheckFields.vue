<script setup lang="ts">
import VariablePicker from '../VariablePicker.vue'
import VariableTextarea from '../VariableTextarea.vue'

defineProps<{
  config: Record<string, any>
  variables: Array<{ group: string, label: string, value: string, icon?: string }>
}>()
const emit = defineEmits<{ update: [patch: Record<string, any>] }>()
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Page address" size="sm" help="A public page. The step takes a screenshot and a vision model looks at it.">
      <VariablePicker
        :model-value="config.url || ''"
        :variables="variables"
        placeholder="https://example.com"
        @update:model-value="emit('update', { url: $event })"
      />
    </UFormField>
    <UFormField label="What it should look like" size="sm" help="Plain requirements, one per line. The page is judged against these.">
      <VariableTextarea
        :model-value="config.requirements || ''"
        :variables="variables"
        :rows="5"
        placeholder="Clear headline above the fold&#10;One main button, easy to see&#10;Text readable on a phone"
        @update:model-value="emit('update', { requirements: $event })"
      />
    </UFormField>
    <UFormField label="Earlier problems (optional)" size="sm" help="Pass the defects from a first look, e.g. {{check.defects}}, to see which are fixed.">
      <VariablePicker
        :model-value="config.previous || ''"
        :variables="variables"
        placeholder="{{check.defects}}"
        @update:model-value="emit('update', { previous: $event })"
      />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Width (px)" size="sm" help="390 is a phone.">
        <UInput
          :model-value="config.width ?? 1280"
          type="number"
          :min="320"
          :max="1920"
          size="sm"
          class="w-full"
          @update:model-value="emit('update', { width: Math.min(1920, Math.max(320, Number($event) || 1280)) })"
        />
      </UFormField>
      <UFormField label="Colours" size="sm">
        <USelect
          :model-value="config.colorScheme || 'light'"
          :items="[{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]"
          size="sm"
          class="w-full"
          @update:model-value="emit('update', { colorScheme: $event })"
        />
      </UFormField>
    </div>
    <USwitch
      :model-value="Boolean(config.fullPage)"
      label="Capture the whole page"
      description="Off looks only at the top of the page."
      @update:model-value="emit('update', { fullPage: $event })"
    />
  </div>
</template>
