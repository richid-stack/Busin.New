<script setup lang="ts">
import type { PromptAttachment } from '../composables/usePromptAttachments'

defineProps<{
  attachments: PromptAttachment[]
}>()

const emit = defineEmits<{
  remove: [index: number]
}>()
</script>

<template>
  <div
    v-if="attachments.length > 0"
    class="flex flex-wrap gap-2 px-3 pt-3"
  >
    <template
      v-for="(attachment, index) in attachments"
      :key="`${attachment.file.name}-${index}`"
    >
      <div
        v-if="attachment.file.type.startsWith('image/')"
        class="relative group"
      >
        <img
          :src="attachment.url"
          class="size-16 object-cover rounded-xl border border-default shadow-sm"
          :alt="attachment.file.name"
        >
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="solid"
          size="xs"
          class="absolute -top-2 -right-2 rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shadow-sm"
          aria-label="Remove attachment"
          @click="emit('remove', index)"
        />
      </div>

      <div
        v-else
        class="relative group flex items-center gap-2 bg-elevated border border-default rounded-md p-1.5 text-xs max-w-[12rem] pr-8 shadow-sm"
      >
        <UIcon
          :name="attachment.file.type.includes('pdf') ? 'i-lucide-file-text' : 'i-lucide-file'"
          class="size-4 shrink-0 text-muted"
        />
        <span class="truncate">{{ attachment.file.name }}</span>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label="Remove attachment"
          @click="emit('remove', index)"
        />
      </div>
    </template>
  </div>
</template>
