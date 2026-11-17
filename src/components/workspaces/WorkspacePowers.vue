<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspacePowers } from '../../types/workspaces'
import Reveal from '../state/Reveal.vue'

// What the assistant may use in one workspace. One row in the side panel that slides open. A workspace can only
// switch things off: a power that is off in Settings shows as off and locked, with the way to Settings.
type Key = keyof WorkspacePowers
const props = defineProps<{ powers: WorkspacePowers, account: Partial<WorkspacePowers> | null, open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean], change: [Key, boolean] }>()

const ROWS: Array<{ key: Key, title: string }> = [
  { key: 'web', title: 'Search and read the web' },
  { key: 'browser', title: 'Use websites for you' },
  { key: 'computer', title: 'Work on your computer' },
  { key: 'cloud', title: 'Run programs in the cloud' },
  { key: 'apps', title: 'Your connected apps' },
  { key: 'notes', title: 'Keep notes here' }
]

const lockedBySettings = (k: Key) => props.account?.[k] === false
const isOn = (k: Key) => props.powers[k] !== false && !lockedBySettings(k)
const onCount = computed(() => ROWS.filter(r => isOn(r.key)).length)
</script>

<template>
  <section class="pt-5">
    <button type="button" class="flex w-full items-center justify-between gap-3 rounded-md text-left outline-primary/25 focus-visible:outline-2 focus-visible:outline-offset-4" :aria-expanded="open" aria-controls="workspace-powers" @click="emit('update:open', !open)">
      <span class="min-w-0">
        <span class="block font-medium text-highlighted">Powers</span>
        <span class="block text-xs text-muted">What the assistant may use here</span>
      </span>
      <span class="flex shrink-0 items-center gap-2">
        <span class="rounded bg-accented/50 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted">{{ onCount }} of {{ ROWS.length }} on</span>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-dimmed transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
      </span>
    </button>
    <Reveal>
      <div v-if="open" id="workspace-powers" class="mt-2">
        <ul class="divide-y divide-default">
          <li v-for="r in ROWS" :key="r.key" class="flex items-center justify-between gap-3 py-2.5">
            <span class="min-w-0">
              <span :class="lockedBySettings(r.key) ? 'text-muted' : 'text-default'">{{ r.title }}</span>
              <RouterLink v-if="lockedBySettings(r.key)" to="/settings?s=powers" class="block text-xs text-dimmed underline-offset-2 hover:underline">Off in Settings</RouterLink>
            </span>
            <USwitch :model-value="isOn(r.key)" :disabled="lockedBySettings(r.key)" size="sm" :aria-label="r.title" @update:model-value="emit('change', r.key, Boolean($event))" />
          </li>
        </ul>
        <p class="mt-3 text-xs leading-relaxed text-dimmed">A workspace can only switch things off. Settings has the main switches.</p>
      </div>
    </Reveal>
  </section>
</template>
