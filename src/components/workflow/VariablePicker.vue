<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  variables?: Array<{ group: string; label: string; value: string; icon?: string }>
  placeholder?: string
}>(), {
  variables: () => [],
  placeholder: 'Type or select a variable...'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const isOpen = ref(false)

const availableVariables = computed(() => props.variables ?? [])

const insertVariable = (value: string) => {
  // If the modelValue already has content, append it. Otherwise, set it.
  const current = props.modelValue || ''
  emit('update:modelValue', current + (current.endsWith(' ') || current === '' ? '' : ' ') + value)
  isOpen.value = false
}
</script>

<template>
  <div class="relative w-full">
    <UInput
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
      :placeholder="placeholder"
      size="sm"
      class="w-full font-mono text-xs pr-8"
      autocomplete="off"
    >
      <template #trailing>
        <UPopover v-model:open="isOpen" :content="{ side: 'bottom', align: 'end' }" class="flex items-center">
          <UButton
            color="primary"
            variant="ghost"
            icon="i-lucide-brackets"
            size="xs"
            class="h-full"
            title="Insert Variable"
          />
          <template #content>
            <div class="w-64 max-h-72 flex flex-col bg-elevated border border-default rounded-md shadow-lg overflow-hidden">
              <div class="p-2 border-b border-default">
                <span class="text-xs font-semibold text-default px-1">Available Variables</span>
              </div>
              <p v-if="availableVariables.length === 0" class="p-3 text-xs text-muted leading-relaxed">No earlier steps yet. Add a trigger or agent before this node to reference its output here.</p>
              <div v-else class="overflow-y-auto p-1.5 space-y-1">
                <template v-for="(group, i) in [...new Set(availableVariables.map(v => v.group))]" :key="group">
                  <div v-if="i > 0" class="h-px bg-default my-1 mx-2"></div>
                  <div class="px-2 py-1 text-[10px] font-bold tracking-wider uppercase text-muted">{{ group }}</div>
                  <button
                    v-for="v in availableVariables.filter(v => v.group === group)"
                    :key="v.value"
                    @click="insertVariable(v.value)"
                    class="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left rounded-md hover:bg-accented/60 text-xs transition-colors"
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
      </template>
    </UInput>
  </div>
</template>
