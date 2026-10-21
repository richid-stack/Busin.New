<script setup lang="ts">
import { computed } from 'vue'
import VariablePicker from '../VariablePicker.vue'
import VariableTextarea from '../VariableTextarea.vue'

type Variable = { group: string, label: string, value: string, icon?: string }

const props = defineProps<{
  config: Record<string, any>
  variables: Variable[]
}>()
const emit = defineEmits<{ update: [patch: Record<string, any>] }>()

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
const method = computed(() => String(props.config.method || 'GET').toUpperCase())
const hasBody = computed(() => method.value !== 'GET' && method.value !== 'HEAD')
const headers = computed<Array<{ key: string, value: string }>>(() => props.config.headers ?? [])

function setHeader(index: number, patch: Partial<{ key: string, value: string }>) {
  emit('update', { headers: headers.value.map((h, i) => (i === index ? { ...h, ...patch } : h)) })
}
function addHeader() {
  if (headers.value.length < 20) emit('update', { headers: [...headers.value, { key: '', value: '' }] })
}
function removeHeader(index: number) {
  emit('update', { headers: headers.value.filter((_, i) => i !== index) })
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-[110px_1fr] gap-2">
      <UFormField label="Method" size="sm">
        <USelect
          :model-value="method"
          :items="METHODS"
          size="md"
          class="w-full"
          @update:model-value="emit('update', { method: $event })"
        />
      </UFormField>
      <UFormField label="URL" size="sm">
        <VariablePicker
          :model-value="config.url || ''"
          :variables="variables"
          placeholder="https://api.example.com/items"
          @update:model-value="emit('update', { url: $event })"
        />
      </UFormField>
    </div>

    <UFormField label="Headers" size="sm" help="Saved with the workflow. Use a key you can replace, not a password you reuse elsewhere.">
      <div class="space-y-2">
        <div
          v-for="(header, index) in headers"
          :key="index"
          class="flex items-center gap-2"
        >
          <UInput
            :model-value="header.key"
            placeholder="Authorization"
            size="sm"
            class="w-2/5"
            :ui="{ base: 'font-mono text-xs' }"
            :aria-label="`Header ${index + 1} name`"
            @update:model-value="setHeader(index, { key: $event as string })"
          />
          <UInput
            :model-value="header.value"
            placeholder="Bearer ..."
            size="sm"
            class="flex-1"
            :ui="{ base: 'font-mono text-xs' }"
            :aria-label="`Header ${index + 1} value`"
            @update:model-value="setHeader(index, { value: $event as string })"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Remove header ${index + 1}`"
            @click="removeHeader(index)"
          />
        </div>
        <UButton
          label="Add header"
          icon="i-lucide-plus"
          color="neutral"
          variant="soft"
          size="xs"
          :disabled="headers.length >= 20"
          @click="addHeader"
        />
      </div>
    </UFormField>

    <UFormField
      v-if="hasBody"
      label="Body"
      size="sm"
      help="JSON is sent as application/json. Insert earlier results with the brackets button."
    >
      <VariableTextarea
        :model-value="config.body || ''"
        :variables="variables"
        placeholder="{ &quot;name&quot;: &quot;{{trigger.payload.name}}&quot; }"
        :rows="5"
        @update:model-value="emit('update', { body: $event })"
      />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Time limit (seconds)" size="sm">
        <UInput
          :model-value="config.timeoutSec ?? 15"
          type="number"
          :min="1"
          :max="30"
          size="sm"
          class="w-full"
          @update:model-value="emit('update', { timeoutSec: Math.min(30, Math.max(1, Number($event) || 15)) })"
        />
      </UFormField>
      <UFormField label="Fail on error answers" size="sm" help="Off: carry on and check the status yourself.">
        <USwitch
          :model-value="config.failOnError !== false"
          aria-label="Fail the step when the server answers with an error"
          @update:model-value="emit('update', { failOnError: $event })"
        />
      </UFormField>
    </div>

    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-shield-check"
      title="Public websites only"
      description="Requests go to public web addresses on the standard ports. Local and private addresses are blocked, and redirects are not followed."
    />
  </div>
</template>
