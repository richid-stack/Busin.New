<script setup lang="ts">
import { computed, ref, toRef, useTemplateRef } from 'vue'
import { accentGradient } from '../../../utils/accentGradient'
import { useBrowserView } from '../../../composables/useBrowserView'

/**
 * The live page, and nothing else: a short, wide rectangle. The steps are the trace lines below it and the questions are
 * the usual approval cards. Take over hands the page to you (to sign in, solve a CAPTCHA or pay); what you type goes
 * straight to the page and is never shown to the assistant.
 */
const props = defineProps<{ chatId: string, live: boolean, working: boolean }>()

const view = useBrowserView(toRef(props, 'chatId'), toRef(props, 'live'), toRef(props, 'working'))
const person = computed(() => view.control.value === 'person')
const showing = computed(() => props.live && (view.seen.value || (props.working && !view.ended.value)))

const screen = useTemplateRef<HTMLElement>('screen')
const typing = ref('')
const reveal = ref(false)
function sendTyped() { if (typing.value) { view.typeText(typing.value); typing.value = '' } }
function onKey(e: KeyboardEvent) { if (view.key(e)) e.preventDefault() }
function onWheel(e: WheelEvent) { if (person.value) { e.preventDefault(); view.scroll(e.deltaY) } }
function onPaste(e: ClipboardEvent) { if (person.value) { e.preventDefault(); view.typeText((e.clipboardData?.getData('text') ?? '').slice(0, 500)) } }
</script>

<template>
  <div
    v-if="showing"
    :class="['my-2 rounded-3xl p-2 sm:p-3 min-w-0 max-w-full', accentGradient('browser')]"
    role="group"
    aria-label="Live browser"
  >
    <div
      ref="screen"
      class="relative w-full overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm outline-none aspect-[1100/560]"
      :class="person ? 'cursor-pointer ring-2 ring-primary' : ''"
      :tabindex="person ? 0 : -1"
      @click="person && screen && view.click(screen, $event)"
      @keydown="onKey"
      @wheel="onWheel"
      @paste="onPaste"
    >
      <img
        v-if="view.image.value"
        :src="view.image.value"
        alt="The page the assistant is using"
        class="size-full object-contain select-none"
        :class="view.ended.value ? 'opacity-60' : ''"
        draggable="false"
      >
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center gap-2 text-muted"
      >
        <UIcon
          name="i-lucide-globe"
          class="size-5 animate-pulse"
        />
        <p class="text-xs">
          Opening the browser…
        </p>
      </div>

      <p
        v-if="view.ended.value"
        class="absolute left-2 top-2 rounded-full bg-default/90 px-2.5 py-1 text-[11px] text-muted shadow-sm"
      >
        Browser closed
      </p>

      <div
        v-if="!view.ended.value"
        class="absolute bottom-2 right-2 flex items-center gap-1.5"
      >
        <UButton
          v-if="!person"
          label="Take over"
          icon="i-lucide-hand"
          color="neutral"
          size="xs"
          :loading="view.working.value"
          @click.stop="view.takeOver()"
        />
        <UButton
          v-else
          label="Hand back"
          icon="i-lucide-check"
          color="neutral"
          size="xs"
          :loading="view.working.value"
          @click.stop="view.handBack()"
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="subtle"
          size="xs"
          aria-label="Stop browsing"
          @click.stop="view.close()"
        />
      </div>
    </div>

    <!-- Only while you hold the page: a box that types into it (this is how the keyboard comes up on a phone). -->
    <div
      v-if="person"
      class="mt-2 flex flex-col gap-1.5"
    >
      <p class="px-1 text-xs text-muted">
        You are in control. Click the page, then type. The assistant cannot see what you type.
      </p>
      <div class="flex items-center gap-2">
        <UInput
          v-model="typing"
          :type="reveal ? 'text' : 'password'"
          autocomplete="off"
          placeholder="Type here"
          size="sm"
          class="min-w-0 flex-1"
          @keydown.enter.prevent="sendTyped(); view.pressKey('Enter')"
        >
          <template #trailing>
            <UButton
              :icon="reveal ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              color="neutral"
              variant="link"
              size="xs"
              :aria-label="reveal ? 'Hide what I type' : 'Show what I type'"
              @click="reveal = !reveal"
            />
          </template>
        </UInput>
        <UButton
          label="Send"
          color="neutral"
          variant="subtle"
          size="sm"
          :disabled="!typing"
          @click="sendTyped"
        />
        <UButton
          label="Tab"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="view.pressKey('Tab')"
        />
      </div>
    </div>
    <p
      v-if="view.error.value"
      class="mt-1.5 px-1 text-xs text-error"
    >
      {{ view.error.value }}
    </p>
  </div>
</template>
