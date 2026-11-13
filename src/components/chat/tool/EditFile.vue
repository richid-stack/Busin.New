<script setup lang="ts">
import { computed } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { useWorkPane } from '../../../composables/useWorkPane'

const props = defineProps<{ invocation: any }>()

const streaming = computed(() => isToolStreaming(props.invocation))
const out = computed(() => (props.invocation.output && typeof props.invocation.output === 'object' ? props.invocation.output as Record<string, any> : null))
const failed = computed(() => !streaming.value && out.value?.status !== 'ok')
const pane = useWorkPane()
const isOpen = computed(() => !!out.value?.artifactId && pane.openId.value === out.value.artifactId)

const text = computed(() => (streaming.value ? 'Changing the file...' : failed.value ? 'Could not change the file' : 'Changed the file'))
const suffix = computed(() => out.value?.title || props.invocation.input?.summary || undefined)
</script>

<template>
  <UChatTool
    :text="text"
    :suffix="suffix"
    :streaming="streaming"
    icon="i-lucide-pencil-line"
    chevron="leading"
  >
    <p
      v-if="failed"
      class="text-sm text-muted"
    >
      {{ out?.error || 'The change was not saved.' }}
    </p>
    <template v-else-if="out">
      <p class="text-sm text-muted">
        Change · <span class="text-default">{{ invocation.input?.summary }}</span>
      </p>
      <p class="text-sm text-muted">
        Version · <span class="text-default">{{ out.version }}</span>
      </p>
      <UButton
        v-if="out.artifactId && !isOpen"
        label="Open the file"
        icon="i-lucide-panel-right-open"
        color="neutral"
        variant="link"
        size="xs"
        class="px-0"
        @click="pane.open(out.artifactId)"
      />
    </template>
  </UChatTool>
</template>
