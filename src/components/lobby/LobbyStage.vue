<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { LobbyController } from '../../composables/useLobby'

/**
 * Lobby on stage: a full-screen view made to be talked to from across a room. A big orb that moves with the voice,
 * one large line for what is happening right now, the person's own words as they speak, and a trail of what Lobby
 * just said. A decision shows as a card that can be answered by tapping or by saying yes or no.
 */
const props = defineProps<{ lobby: LobbyController }>()

const typed = ref('')
const label = computed(() => ({ listening: 'Listening', thinking: 'Working on it', speaking: 'Speaking', idle: 'Tap to talk' })[props.lobby.state])
const icon = computed(() => ({ listening: 'i-lucide-mic', thinking: 'i-lucide-sparkles', speaking: 'i-lucide-audio-lines', idle: 'i-lucide-mic' })[props.lobby.state])
const trail = computed(() => props.lobby.history.filter(l => l !== props.lobby.now && l !== props.lobby.pending?.question).slice(-4))

function send() {
  const text = typed.value.trim()
  if (!text) return
  typed.value = ''
  props.lobby.typed(text)
}

// Space talks and interrupts, Escape leaves: the two things a person standing at a stage needs without a mouse.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!props.lobby.open) return
  const target = e.target as HTMLElement | null
  const inField = target && /^(input|textarea|select|button)$/i.test(target.tagName)
  if (e.key === 'Escape') { e.preventDefault(); props.lobby.hide() } else if (e.code === 'Space' && !inField) { e.preventDefault(); props.lobby.tap() }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="stage">
      <div
        v-if="lobby.open"
        class="fixed inset-0 z-[100] flex flex-col bg-default text-default"
        role="dialog"
        aria-modal="true"
        aria-label="Lobby"
      >
        <div class="stage-bg pointer-events-none absolute inset-0" />

        <header class="relative flex items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-5">
          <div class="flex items-center gap-2.5">
            <span class="flex size-8 items-center justify-center rounded-lg border border-default bg-elevated/60"><UIcon
              name="i-lucide-audio-lines"
              class="size-4 text-primary"
            /></span>
            <span class="text-sm font-semibold text-highlighted">Lobby</span>
            <span
              class="ml-1 inline-flex items-center gap-1.5 rounded-full border border-default bg-elevated/60 px-2.5 py-1 text-xs text-muted"
              aria-live="polite"
            >
              <span
                class="size-1.5 rounded-full"
                :class="lobby.state === 'idle' ? 'bg-muted' : 'bg-primary animate-pulse motion-reduce:animate-none'"
              />{{ label }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <UButton
              :icon="lobby.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
              color="neutral"
              variant="ghost"
              :aria-label="lobby.muted ? 'Turn Lobby’s voice on' : 'Mute Lobby’s voice'"
              @click="lobby.toggleMute()"
            />
            <UButton
              label="Show the answer"
              icon="i-lucide-panel-left-open"
              color="neutral"
              variant="subtle"
              class="hidden sm:inline-flex"
              @click="lobby.hide()"
            />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              aria-label="Close Lobby"
              @click="lobby.hide()"
            />
          </div>
        </header>

        <main class="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-5 pb-4 text-center sm:gap-8">
          <button
            type="button"
            class="orb"
            :data-state="lobby.state"
            :style="{ '--level': String(lobby.level) }"
            :aria-label="lobby.state === 'listening' ? 'Done talking, send' : lobby.state === 'idle' ? 'Start talking' : 'Interrupt and talk'"
            @click="lobby.tap()"
          >
            <span class="orb-glow" />
            <span class="orb-ring" />
            <span class="orb-core" />
            <UIcon
              :name="icon"
              class="relative size-9 text-white drop-shadow sm:size-11"
            />
          </button>

          <div class="flex min-h-[7.5rem] w-full max-w-4xl flex-col items-center justify-start gap-3 sm:min-h-[9rem]">
            <Transition
              name="line"
              mode="out-in"
            >
              <p
                v-if="lobby.now"
                :key="lobby.now"
                class="text-balance text-2xl font-semibold leading-snug text-highlighted sm:text-4xl"
                aria-live="polite"
              >
                {{ lobby.now }}
              </p>
              <p
                v-else-if="lobby.state === 'listening' && !lobby.heard"
                key="listening"
                class="text-balance text-2xl font-medium text-muted sm:text-3xl"
              >
                I’m listening…
              </p>
              <p
                v-else-if="lobby.state === 'thinking'"
                key="thinking"
                class="text-balance text-2xl font-medium text-muted sm:text-3xl"
              >
                On it…
              </p>
              <p
                v-else-if="lobby.state === 'idle' && !lobby.heard"
                key="idle"
                class="text-balance text-xl text-muted sm:text-2xl"
              >
                Tap the orb or press space, and tell me what to do.
              </p>
            </Transition>

            <p
              v-if="lobby.heard"
              class="max-w-3xl text-balance text-lg text-muted sm:text-2xl"
            >
              <span class="text-dimmed">You: </span>“{{ lobby.heard }}”
            </p>
          </div>

          <TransitionGroup
            name="trail"
            tag="ul"
            class="flex w-full max-w-2xl flex-col items-center gap-1.5"
            aria-label="What Lobby just said"
          >
            <li
              v-for="(line, i) in trail"
              :key="line"
              class="flex items-start gap-2 text-sm text-muted"
              :style="{ opacity: String(0.35 + (i + 1) / (trail.length + 1) * 0.5) }"
            >
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-3.5 shrink-0 text-primary"
              />
              <span class="text-left">{{ line }}</span>
            </li>
          </TransitionGroup>

          <div
            v-if="lobby.pending"
            class="w-full max-w-xl rounded-3xl border border-default bg-default/80 p-4 text-left shadow-lg backdrop-blur sm:p-5"
            role="group"
            aria-label="Needs your answer"
          >
            <div class="flex items-start gap-3">
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-default bg-elevated"><UIcon
                name="i-lucide-shield-question"
                class="size-5 text-warning"
              /></span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-highlighted">
                  It needs your OK first
                </p>
                <p class="mt-1 text-sm text-default">
                  {{ lobby.pending.question }}
                </p>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <UButton
                label="Approve"
                icon="i-lucide-check"
                size="lg"
                @click="lobby.decide(true)"
              />
              <UButton
                label="Decline"
                icon="i-lucide-x"
                color="neutral"
                variant="subtle"
                size="lg"
                @click="lobby.decide(false)"
              />
              <span class="ml-auto hidden text-xs text-muted sm:inline">or just say yes or no</span>
            </div>
          </div>
        </main>

        <footer class="relative mx-auto w-full max-w-2xl px-4 pb-5 sm:pb-8">
          <p
            v-if="lobby.notice"
            class="mb-3 flex items-start gap-2 rounded-xl border border-default bg-elevated/60 px-3 py-2 text-left text-sm text-default"
            role="status"
          >
            <UIcon
              name="i-lucide-info"
              class="mt-0.5 size-4 shrink-0 text-warning"
            />{{ lobby.notice }}
          </p>
          <form
            class="flex items-center gap-2"
            @submit.prevent="send"
          >
            <UInput
              v-model="typed"
              placeholder="Or type here…"
              size="lg"
              class="flex-1"
              aria-label="Type to Lobby"
              autocomplete="off"
            />
            <UButton
              type="submit"
              icon="i-lucide-arrow-up"
              size="lg"
              :disabled="!typed.trim()"
              aria-label="Send"
            />
          </form>
          <p class="mt-3 hidden text-center text-xs text-dimmed sm:block">
            Space to talk or interrupt · Esc to leave
          </p>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.stage-bg {
  background:
    radial-gradient(60rem 36rem at 50% 28%, color-mix(in oklab, var(--ui-primary) 14%, transparent), transparent 70%),
    radial-gradient(40rem 30rem at 85% 100%, color-mix(in oklab, var(--ui-primary) 8%, transparent), transparent 70%);
}

.orb {
  --size: clamp(9rem, 24vmin, 15rem);
  position: relative;
  display: grid;
  place-items: center;
  width: var(--size);
  height: var(--size);
  border-radius: 9999px;
  cursor: pointer;
  transform: scale(calc(1 + var(--level, 0) * 0.3));
  transition: transform 0.12s ease-out;
  -webkit-tap-highlight-color: transparent;
}
.orb:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 8px; }
.orb > span { position: absolute; border-radius: inherit; }
.orb-core {
  inset: 12%;
  background: radial-gradient(circle at 30% 25%, color-mix(in oklab, var(--ui-primary) 55%, white) 0%, var(--ui-primary) 55%, color-mix(in oklab, var(--ui-primary) 70%, black) 100%);
  box-shadow: 0 0 70px color-mix(in oklab, var(--ui-primary) 45%, transparent), inset 0 -12px 34px rgb(0 0 0 / 0.25);
}
.orb-glow {
  inset: -22%;
  background: radial-gradient(circle, color-mix(in oklab, var(--ui-primary) 38%, transparent), transparent 66%);
  filter: blur(12px);
  animation: breathe 5s ease-in-out infinite;
}
.orb-ring {
  inset: 3%;
  border: 2px solid color-mix(in oklab, var(--ui-primary) 28%, transparent);
  border-top-color: var(--ui-primary);
  opacity: 0;
  transition: opacity 0.3s;
}
.orb[data-state='idle'] .orb-core { opacity: 0.78; }
.orb[data-state='listening'] .orb-glow { animation-duration: 2.2s; }
.orb[data-state='speaking'] .orb-core { animation: speak 0.9s ease-in-out infinite; }
.orb[data-state='speaking'] .orb-glow { animation-duration: 1.8s; }
.orb[data-state='thinking'] .orb-ring { opacity: 1; animation: spin 1.1s linear infinite; }
.orb[data-state='thinking'] .orb-core { animation: breathe 1.8s ease-in-out infinite; }

@keyframes breathe { 0%, 100% { transform: scale(0.96); opacity: 0.85; } 50% { transform: scale(1.04); opacity: 1; } }
@keyframes speak { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
@keyframes spin { to { transform: rotate(360deg); } }

.stage-enter-active, .stage-leave-active { transition: opacity 0.25s ease; }
.stage-enter-from, .stage-leave-to { opacity: 0; }
.line-enter-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.line-leave-active { transition: opacity 0.15s ease; }
.line-enter-from { opacity: 0; transform: translateY(10px); }
.line-leave-to { opacity: 0; }
.trail-enter-active, .trail-leave-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.trail-enter-from { opacity: 0; transform: translateY(8px); }
.trail-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .orb, .orb > span, .line-enter-active, .trail-enter-active { animation: none !important; transition: none !important; }
  .orb { transform: none; }
}
</style>
