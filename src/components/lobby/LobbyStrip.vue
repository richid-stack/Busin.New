<script setup lang="ts">
import { computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { LobbyController } from '../../composables/useLobby'

/**
 * One quiet line above the message box while Lobby is on: what it is doing, the words it just heard, and the two
 * controls that matter (mute its voice, stop talking to it). Everything else happens in the chat itself.
 */
const props = defineProps<{ lobby: LobbyController }>()

const label = computed(() => ({ listening: 'Listening', thinking: 'Working on it', speaking: 'Speaking', idle: 'Paused' })[props.lobby.state])
const caption = computed(() => {
  if (props.lobby.notice) return props.lobby.notice
  if (props.lobby.pending) return 'Say yes or no, or use the buttons above.'
  if (props.lobby.heard) return `“${props.lobby.heard}”`
  if (props.lobby.state === 'listening') return 'Say what you need.'
  if (props.lobby.state === 'idle') return 'Tap the mic to talk.'
  return ''
})

useEventListener(window, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') props.lobby.hide() })
</script>

<template>
  <div
    class="flex items-center gap-2 px-1 pb-2 text-xs"
    role="status"
    aria-live="polite"
  >
    <span class="inline-flex shrink-0 items-center gap-1.5 font-medium text-highlighted">
      <span
        class="size-1.5 rounded-full"
        :class="lobby.state === 'idle' ? 'bg-muted' : 'bg-primary animate-pulse motion-reduce:animate-none'"
      />{{ label }}
    </span>
    <span class="min-w-0 flex-1 truncate text-muted">{{ caption }}</span>
    <UButton
      :icon="lobby.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="lobby.muted ? 'Turn Lobby’s voice on' : 'Mute Lobby’s voice'"
      @click="lobby.toggleMute()"
    />
    <UButton
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="xs"
      aria-label="Stop talking to Lobby"
      @click="lobby.hide()"
    />
  </div>
</template>
