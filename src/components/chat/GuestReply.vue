<script setup lang="ts">
import { computed } from 'vue'
import { pickGuestReply } from '../../utils/guestReply'

const props = defineProps<{ message: string }>()
const emit = defineEmits<{ signup: [], signin: [] }>()

const reply = computed(() => pickGuestReply(props.message))
</script>

<template>
  <div class="flex flex-col gap-4 w-full" aria-live="polite">
    <div class="self-end max-w-[85%] rounded-2xl rounded-br-md bg-elevated border border-default px-4 py-2.5 text-sm text-default whitespace-pre-wrap break-words">
      {{ message }}
    </div>

    <div class="flex items-start gap-3">
      <div class="size-8 shrink-0 rounded-full border border-default bg-default shadow-sm flex items-center justify-center">
        <img src="/favicon.svg" alt="" class="size-5">
      </div>
      <div class="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-default bg-default shadow-sm p-5">
        <p class="text-sm font-semibold text-highlighted mb-1">Hi, I'm OpenLobs.</p>
        <p class="text-sm text-default leading-relaxed mb-3">{{ reply.opening }}</p>

        <ul class="space-y-1.5 mb-4">
          <li v-for="item in reply.highlights" :key="item" class="flex items-start gap-2 text-sm text-muted">
            <UIcon name="i-lucide-check" class="size-4 mt-0.5 shrink-0 text-primary" />
            <span>{{ item }}</span>
          </li>
        </ul>

        <p class="text-sm text-default leading-relaxed mb-4">
          To keep your chats and connected apps private, I need you to sign in first. It takes a few seconds, and I will answer your message the moment you are in.
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <UButton label="Create account" icon="i-lucide-user-plus" color="neutral" @click="emit('signup')" />
          <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" variant="subtle" @click="emit('signin')" />
        </div>
      </div>
    </div>
  </div>
</template>
