<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { stepText } from '../../../../shared/utils/browserSteps'

/** One step in the browser, as a trace line like every other tool: a line with the shimmer while it runs, and what lies behind it when opened. */
// The parent hands over state, input and output as separate values: a part is updated in place while a reply streams.
const props = defineProps<{ state?: string, input?: any, output?: any, controls: string }>()

const streaming = computed(() => isToolStreaming({ state: props.state ?? 'input-streaming' } as any))
const output = computed(() => (props.output && typeof props.output === 'object' ? props.output : null) as Record<string, any> | null)
const failed = computed(() => !streaming.value && (props.state === 'output-error' || !output.value || output.value.status === 'failed'))
const input = computed(() => props.input ?? {})

const text = computed(() => stepText(input.value, props.controls, streaming.value ? 'doing' : failed.value ? 'failed' : 'done'))
// The words already name the site for an opened page, so the side note is the page's own title.
const suffix = computed(() => (typeof output.value?.title === 'string' && output.value.title ? output.value.title.slice(0, 48) : undefined))
const typed = computed(() => (input.value.action === 'type' && input.value.text ? String(input.value.text).slice(0, 120) : ''))
const hasMore = computed(() => failed.value || Boolean(typed.value || output.value?.title || output.value?.notes?.length || output.value?.needsPerson || output.value?.scroll))
</script>

<template>
  <UChatTool
    :text="text"
    :suffix="suffix"
    :streaming="streaming"
    icon="i-lucide-globe"
    chevron="leading"
  >
    <div
      v-if="hasMore"
      class="space-y-1 text-sm text-muted"
    >
      <p v-if="failed">
        {{ output?.error || 'The browser did not answer.' }}
      </p>
      <template v-else>
        <p v-if="typed">
          Typed “{{ typed }}”
        </p>
        <p v-if="output?.url">
          Now on <span class="text-highlighted">{{ output.title || output.url }}</span> · {{ output.url }}
        </p>
        <p v-if="output?.scroll">
          {{ output.scroll }}
        </p>
        <p
          v-for="n in output?.notes ?? []"
          :key="n"
        >
          {{ n }}
        </p>
        <p
          v-if="output?.needsPerson"
          class="text-warning"
        >
          This page needs you: press Take over on the browser above.
        </p>
      </template>
    </div>
  </UChatTool>
</template>
