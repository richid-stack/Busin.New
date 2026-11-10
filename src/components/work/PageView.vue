<script setup lang="ts">
import { computed } from 'vue'
import type { PageContent } from '../../types/artifacts'
import { previewDocument } from '../../utils/pagePreview'
import ChangeBox from './ChangeBox.vue'

const props = defineProps<{ spec: PageContent, busy: boolean, label: string }>()
const emit = defineEmits<{ change: [text: string] }>()

const doc = computed(() => previewDocument(props.spec.html, props.spec.title))
</script>

<template>
  <div class="mx-auto max-w-[760px]">
    <div class="rounded-xl border border-default bg-default shadow-md overflow-hidden">
      <div class="flex items-center gap-1.5 px-3 h-9 border-b border-default bg-elevated/70">
        <span class="size-2.5 rounded-full bg-accented" /><span class="size-2.5 rounded-full bg-accented" /><span class="size-2.5 rounded-full bg-accented" />
        <span class="ms-3 text-[11px] text-muted truncate rounded-md bg-default border border-default px-2 py-0.5 flex-1 max-w-xs">Preview · runs on its own, never touches OpenLobs</span>
      </div>
      <iframe
        :srcdoc="doc"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        :title="`Preview of ${spec.title}`"
        class="block w-full h-[62vh] min-h-[420px] bg-white"
      />
    </div>
    <div class="mt-3">
      <ChangeBox placeholder="Ask for a change, e.g. “bigger button”" :busy="busy" :label="label" @change="emit('change', $event)" />
    </div>
  </div>
</template>
