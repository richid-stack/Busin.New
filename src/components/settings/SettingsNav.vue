<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

export interface SettingsSection { id: string, label: string, icon: string }

const props = defineProps<{ sections: SettingsSection[], modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

// On a phone the list is one row you swipe; keep the chosen section in view.
const list = ref<HTMLElement | null>(null)
watch(() => props.modelValue, async () => {
  await nextTick()
  list.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
}, { immediate: true, flush: 'post' })
</script>

<template>
  <nav aria-label="Settings sections" class="-mx-4 shrink-0 self-start overflow-x-auto px-4 md:sticky md:top-10 md:mx-0 md:w-52 md:overflow-visible md:px-0">
    <ul ref="list" class="flex w-max gap-1 md:w-auto md:flex-col">
      <li v-for="s in sections" :key="s.id">
        <button
          type="button"
          class="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors outline-primary/25 focus-visible:outline-2"
          :class="s.id === modelValue ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:bg-elevated/50 hover:text-highlighted'"
          :aria-current="s.id === modelValue ? 'page' : undefined"
          @click="emit('update:modelValue', s.id)"
        >
          <UIcon :name="s.icon" class="size-4 shrink-0" />{{ s.label }}
        </button>
      </li>
    </ul>
  </nav>
</template>
