<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'

export interface CopilotMessage {
  role: 'user' | 'assistant'
  text: string
}

const props = defineProps<{
  messages: CopilotMessage[]
  loading: boolean
}>()

const emit = defineEmits<{
  send: [prompt: string]
  close: []
}>()

const draft = ref('')
const scroller = ref<HTMLElement | null>(null)

function submit() {
  const prompt = draft.value.trim()
  if (!prompt || props.loading) return
  emit('send', prompt)
  draft.value = ''
}

watch(() => [props.messages.length, props.loading], async () => {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
})

const suggestions = [
  'Add a Slack alert at the end',
  'Add an approval step before sending',
  'Summarise the input with an AI agent first'
]
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="p-4 border-b border-default flex items-center justify-between bg-primary/5 shrink-0">
      <div class="flex items-center gap-2 text-primary">
        <UIcon name="i-lucide-sparkles" class="size-4" />
        <h3 class="font-semibold text-sm">AI Copilot</h3>
      </div>
      <UButton color="neutral" variant="ghost" icon="i-lucide-x" size="xs" aria-label="Close copilot" @click="emit('close')" />
    </div>

    <div ref="scroller" class="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="flex flex-col gap-1"
        :class="message.role === 'user' ? 'items-end' : 'items-start'"
      >
        <div
          class="px-3 py-2 rounded-xl max-w-[90%] whitespace-pre-wrap"
          :class="message.role === 'user' ? 'bg-primary text-inverted' : 'bg-default text-default border border-default'"
        >
          {{ message.text }}
        </div>
      </div>

      <div v-if="loading" class="flex items-start">
        <div class="px-3 py-2 rounded-xl bg-default border border-default">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-primary" />
        </div>
      </div>

      <div v-if="messages.length <= 1 && !loading" class="flex flex-col gap-2 pt-2">
        <button
          v-for="suggestion in suggestions"
          :key="suggestion"
          type="button"
          class="text-left text-xs text-muted border border-default rounded-lg px-3 py-2 hover:bg-accented/50 hover:text-default transition-colors"
          @click="emit('send', suggestion)"
        >
          {{ suggestion }}
        </button>
      </div>
    </div>

    <div class="p-3 border-t border-default shrink-0">
      <UInput
        v-model="draft"
        placeholder="Describe a change..."
        size="md"
        class="w-full"
        :disabled="loading"
        @keydown.enter.prevent="submit"
      >
        <template #trailing>
          <UButton
            color="primary"
            variant="ghost"
            icon="i-lucide-send"
            size="xs"
            aria-label="Send"
            :loading="loading"
            :disabled="!draft.trim()"
            @click="submit"
          />
        </template>
      </UInput>
    </div>
  </div>
</template>
