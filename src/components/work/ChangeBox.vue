<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ placeholder: string, busy?: boolean, label?: string }>()
const emit = defineEmits<{ change: [text: string] }>()

const text = ref('')
const input = ref<HTMLInputElement | null>(null)

function send() {
  const value = text.value.trim()
  if (!value || props.busy) return
  emit('change', value)
  text.value = ''
}

watch(() => props.label, () => { text.value = '' })
defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <form
    class="flex items-center gap-2 rounded-xl border border-default bg-default p-1.5 shadow-sm text-default focus-within:border-primary/60 transition-colors"
    @submit.prevent="send"
    @click.stop
  >
    <UIcon
      name="i-lucide-pencil-line"
      class="size-4 text-primary ms-2 shrink-0"
    />
    <input
      ref="input"
      v-model="text"
      type="text"
      maxlength="500"
      :placeholder="placeholder"
      :aria-label="label ? `Change: ${label}` : 'Ask for a change'"
      class="flex-1 min-w-0 bg-transparent text-[13px] text-highlighted placeholder:text-muted outline-none"
    >
    <UButton
      type="submit"
      label="Change"
      size="xs"
      color="neutral"
      :disabled="!text.trim() || busy"
      :loading="busy"
    />
  </form>
</template>
