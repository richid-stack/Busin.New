<script setup lang="ts">
import { computed } from 'vue'
import VariablePicker from '../VariablePicker.vue'

type Field = { key: string, value: string, mode: 'text' | 'expression' | 'json' }

const props = defineProps<{
  config: Record<string, any>
  variables: Array<{ group: string, label: string, value: string, icon?: string }>
}>()
const emit = defineEmits<{ update: [patch: Record<string, any>] }>()

const MODES = [
  { label: 'Text', value: 'text' },
  { label: 'Formula', value: 'expression' },
  { label: 'JSON', value: 'json' }
]
const HELP: Record<string, string> = {
  text: 'Fills in {{placeholders}} and keeps the result as text.',
  expression: 'A formula such as prev.result * 2 or trigger.payload.amount > 30.',
  json: 'Fills in placeholders, then reads the text as JSON (a number, list or object).'
}

const EXAMPLE = '{{this-step.field_name}}'

const fields = computed<Field[]>(() => props.config.fields ?? [])
function setField(index: number, patch: Partial<Field>) {
  emit('update', { fields: fields.value.map((f, i) => (i === index ? { ...f, ...patch } : f)) })
}
function addField() {
  if (fields.value.length < 50) emit('update', { fields: [...fields.value, { key: '', value: '', mode: 'text' }] })
}
function removeField(index: number) {
  emit('update', { fields: fields.value.filter((_, i) => i !== index) })
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="(field, index) in fields"
      :key="index"
      class="rounded-lg border border-default p-2.5 space-y-2"
    >
      <div class="flex items-center gap-2">
        <UInput
          :model-value="field.key"
          placeholder="field_name"
          size="sm"
          class="flex-1"
          :ui="{ base: 'font-mono text-xs' }"
          :aria-label="`Field ${index + 1} name`"
          @update:model-value="setField(index, { key: $event as string })"
        />
        <USelect
          :model-value="field.mode || 'text'"
          :items="MODES"
          size="sm"
          class="w-28"
          :aria-label="`Field ${index + 1} type`"
          @update:model-value="setField(index, { mode: $event as Field['mode'] })"
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="`Remove field ${index + 1}`"
          @click="removeField(index)"
        />
      </div>
      <VariablePicker
        :model-value="field.value"
        :variables="variables"
        :placeholder="field.mode === 'expression' ? 'prev.result * 2' : 'Value'"
        @update:model-value="setField(index, { value: $event })"
      />
      <p class="text-[11px] text-muted">{{ HELP[field.mode || 'text'] }}</p>
    </div>
    <UButton
      label="Add field"
      icon="i-lucide-plus"
      color="neutral"
      variant="soft"
      size="xs"
      :disabled="fields.length >= 50"
      @click="addField"
    />
    <p class="text-xs text-muted">Later steps read each field as <code class="font-mono">{{ EXAMPLE }}</code>.</p>
  </div>
</template>
