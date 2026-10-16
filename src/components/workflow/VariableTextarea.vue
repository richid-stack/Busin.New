<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  rows?: number
  placeholder?: string
  variables?: Array<{ group: string; label: string; value: string; icon?: string }>
}>(), {
  rows: 3,
  placeholder: 'Type or select a variable...',
  variables: () => []
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const isOpen = ref(false)

const defaultVariables = [
  { group: 'Trigger', label: 'Email Subject', value: '{{trigger.email.subject}}', icon: 'i-lucide-mail' },
  { group: 'Trigger', label: 'Email Body', value: '{{trigger.email.body}}', icon: 'i-lucide-align-left' },
  { group: 'Trigger', label: 'Sender', value: '{{trigger.email.sender}}', icon: 'i-lucide-user' },
  { group: 'Trigger', label: 'Date', value: '{{trigger.email.date}}', icon: 'i-lucide-calendar' },
  { group: 'AI Agent', label: 'Triage Result', value: '{{ai-triage.result}}', icon: 'i-lucide-brain' },
  { group: 'AI Agent', label: 'Writer Output', value: '{{ai-writer.result}}', icon: 'i-lucide-pen-tool' },
  { group: 'AI Agent', label: 'Scheduler Output', value: '{{ai-scheduler.result}}', icon: 'i-lucide-calendar-clock' }
]

const availableVariables = computed(() => {
  return props.variables && props.variables.length > 0 ? props.variables : defaultVariables
})

const insertVariable = (value: string) => {
  const current = props.modelValue || ''
  emit('update:modelValue', current + (current.endsWith(' ') || current === '' || current.endsWith('\n') ? '' : ' ') + value)
  isOpen.value = false
}
</script>

<template>
  <div class="relative w-full">
    <UTextarea
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
      :placeholder="placeholder || 'Type or select a variable...'"
      :rows="rows || 3"
      class="w-full text-xs"
      autocomplete="off"
    />
    <div class="absolute bottom-2 right-2 z-10">
      <UPopover v-model:open="isOpen" :popper="{ placement: 'top-end' }" class="flex items-center">
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-brackets"
          size="xs"
          class="shadow-sm"
          title="Insert Variable"
        />
        <template #panel>
          <div class="w-64 max-h-72 flex flex-col bg-elevated border border-default rounded-md shadow-lg overflow-hidden">
            <div class="p-2 border-b border-default flex items-center justify-between">
              <span class="text-xs font-semibold text-default px-1">Available Variables</span>
              <UIcon name="i-lucide-x" class="size-3.5 text-muted cursor-pointer hover:text-default" @click="isOpen = false" />
            </div>
            <div class="overflow-y-auto p-1.5 space-y-1">
              <template v-for="(group, i) in [...new Set(availableVariables.map(v => v.group))]" :key="group">
                <div v-if="i > 0" class="h-px bg-default my-1 mx-2"></div>
                <div class="px-2 py-1 text-[10px] font-bold tracking-wider uppercase text-muted">{{ group }}</div>
                <button
                  v-for="v in availableVariables.filter(v => v.group === group)"
                  :key="v.value"
                  @click="insertVariable(v.value)"
                  class="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left rounded-md hover:bg-accented text-xs transition-colors"
                >
                  <div class="flex items-center gap-2">
                    <UIcon :name="v.icon" class="size-3.5 text-muted" />
                    <span class="text-default font-medium">{{ v.label }}</span>
                  </div>
                  <span class="text-[9px] font-mono text-muted px-1 py-0.5 rounded border border-default truncate max-w-[80px]">
                    {{ v.value }}
                  </span>
                </button>
              </template>
            </div>
          </div>
        </template>
      </UPopover>
    </div>
  </div>
</template>
