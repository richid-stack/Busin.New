<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue'
import type { UIMessage } from 'ai'
import { isFileUIPart, isReasoningUIPart, isToolUIPart } from 'ai'
import { useClipboard } from '@vueuse/core'
import { getTextFromMessage } from '@nuxt/ui/utils/ai'

const ModalAgentActivity = defineAsyncComponent(() => import('../ModalAgentActivity.vue'))

const props = defineProps<{
  message: UIMessage & { createdAt?: string | Date }
  streaming: boolean
  editing: boolean
  vote: boolean | null
}>()

const formattedDate = computed(() => {
  if (!props.message.createdAt) return null

  const date = new Date(props.message.createdAt)

  return {
    time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    full: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    iso: date.toISOString()
  }
})

const emit = defineEmits<{
  edit: [message: UIMessage]
  regenerate: [message: UIMessage]
  vote: [message: UIMessage, isUpvoted: boolean]
}>()

const hasFiles = computed(() => props.message.parts.some(isFileUIPart))
const hasActivity = computed(() => {
  return props.message.parts?.some(p => isReasoningUIPart(p) || isToolUIPart(p)) ?? false
})

const overlay = useOverlay()
const activityModal = overlay.create(ModalAgentActivity)

function openActivity() {
  activityModal.open({ message: props.message })
}

const clipboard = useClipboard()

const copied = ref(false)

function copy() {
  clipboard.copy(getTextFromMessage(props.message))

  copied.value = true

  setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <template v-if="message.role === 'assistant' && !streaming">
    <UTooltip text="Copy response">
      <UButton
        size="sm"
        :color="copied ? 'primary' : 'neutral'"
        variant="ghost"
        :icon="copied ? 'i-lucide-copy-check' : 'i-lucide-copy'"
        aria-label="Copy response"
        @click="copy"
      />
    </UTooltip>

    <UTooltip text="Good response">
      <UButton
        size="sm"
        :color="vote === true ? 'success' : 'neutral'"
        variant="ghost"
        icon="i-lucide-thumbs-up"
        aria-label="Good response"
        @click="emit('vote', message, true)"
      />
    </UTooltip>

    <UTooltip text="Bad response">
      <UButton
        size="sm"
        :color="vote === false ? 'error' : 'neutral'"
        variant="ghost"
        icon="i-lucide-thumbs-down"
        aria-label="Bad response"
        @click="emit('vote', message, false)"
      />
    </UTooltip>

    <UTooltip text="Regenerate response">
      <UButton
        size="sm"
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-cw"
        aria-label="Regenerate response"
        @click="emit('regenerate', message)"
      />
    </UTooltip>

    <UTooltip
      v-if="hasActivity"
      text="Agent activity & timeline"
    >
      <UButton
        size="sm"
        color="neutral"
        variant="ghost"
        icon="i-lucide-activity"
        aria-label="Agent activity"
        @click="openActivity"
      />
    </UTooltip>
  </template>

  <template v-if="message.role === 'user' && !streaming && !editing">
    <UTooltip
      v-if="formattedDate"
      :text="formattedDate.full"
    >
      <time
        :datetime="formattedDate.iso"
        class="text-xs text-muted mr-1.5"
      >
        {{ formattedDate.time }}
      </time>
    </UTooltip>

    <UTooltip
      v-if="!hasFiles"
      text="Edit message"
    >
      <UButton
        size="sm"
        color="neutral"
        variant="ghost"
        icon="i-lucide-pencil"
        aria-label="Edit message"
        @click="emit('edit', message)"
      />
    </UTooltip>
  </template>
</template>
