<script setup lang="ts">
import { onMounted } from 'vue'
import { usePowers } from '../../composables/usePowers'
import { useMemory } from '../../composables/useMemory'
import { useBrowserWhere } from '../../composables/useBrowserWhere'
import type { Power } from '../../../shared/powers'
import SettingRow from './SettingRow.vue'

const toast = useToast()
const { powers, failed, fetchPowers, setPower } = usePowers()
const { enabled: memoryOn, loaded: memoryLoaded, fetchMemory, setEnabled: setMemory } = useMemory()
const { browserWhere, fetchBrowserWhere, setBrowserWhere } = useBrowserWhere()

onMounted(() => {
  void fetchPowers()
  void fetchBrowserWhere()
  if (!memoryLoaded.value) void fetchMemory()
})

const ROWS: Array<{ key: Power, title: string, hint: string }> = [
  { key: 'web', title: 'Search and read the web', hint: 'Looking things up and reading pages. Photos, icons and fonts too.' },
  { key: 'browser', title: 'Use websites for you', hint: 'Opening sites, filling forms, clicking. Still stops before it sends, pays or deletes.' },
  { key: 'computer', title: 'Work on your computer', hint: 'Through the Bridge: spreadsheets, your browser profile, programs you approve.' },
  { key: 'cloud', title: 'Run programs in the cloud', hint: 'Builds and tests on a temporary machine. Each run costs credits.' },
  { key: 'apps', title: 'Your connected apps and tool servers', hint: 'Google, Microsoft, Slack and the rest you connected. Each action still shows what it will change.' }
]

const fail = (err: any) => toast.add({ title: 'Could not change that', description: err?.data?.statusMessage || err?.statusMessage || err?.message || 'Try again.', icon: 'i-lucide-alert-circle', color: 'error' })
const toggle = (key: Power, value: boolean) => setPower(key, value).catch(fail)
const onComputer = (value: boolean) => setBrowserWhere(value ? 'computer' : 'cloud').catch(fail)
const toggleMemory = (value: boolean) => setMemory(value).catch(fail)

const MANAGE = [
  { to: '/integrations', title: 'Connected apps', icon: 'i-lucide-blocks' },
  { to: '/integrations/mcp', title: 'Tool servers (MCP)', icon: 'i-lucide-plug' },
  { to: '/computers', title: 'Computers', icon: 'i-lucide-monitor' },
  { to: '/skills', title: 'Skills', icon: 'i-lucide-book-open-text' },
  { to: '/memory', title: 'Memory', icon: 'i-lucide-brain' },
  { to: '/agents', title: 'Agents', icon: 'i-lucide-bot' },
  { to: '/workflows', title: 'Workflows', icon: 'i-lucide-workflow' }
]
</script>

<template>
  <div>
    <p v-if="failed" class="mt-3 text-xs text-warning" role="status">Could not load your switches, so they show as on. Reload to try again.</p>
    <div class="mt-4 divide-y divide-default border-y border-default">
      <template v-for="r in ROWS" :key="r.key">
        <SettingRow :title="r.title" :hint="r.hint">
          <USwitch :model-value="powers?.[r.key] !== false" :disabled="!powers" :aria-label="r.title" @update:model-value="toggle(r.key, Boolean($event))" />
        </SettingRow>
        <!-- Where the browser runs only matters while the browser is on -->
        <SettingRow v-if="r.key === 'browser' && powers?.browser !== false && browserWhere" class="!py-3 pl-4" title="Use the browser on my computer" hint="A profile of its own, so sites you signed in to there stay signed in. Off: a fresh browser in the cloud.">
          <USwitch :model-value="browserWhere.where === 'computer'" aria-label="Use the browser on my computer" @update:model-value="onComputer(Boolean($event))" />
          <template #extra>
            <p class="mt-1 text-xs leading-snug" :class="browserWhere.computer.ready ? 'text-dimmed' : 'text-warning'">{{ browserWhere.computer.note }}</p>
          </template>
        </SettingRow>
      </template>
      <SettingRow title="Remember things about you" hint="Notes kept between chats. The same switch as on the Memory page.">
        <USwitch :model-value="memoryOn" :disabled="!memoryLoaded" aria-label="Remember things about you" @update:model-value="toggleMemory(Boolean($event))" />
      </SettingRow>
    </div>
    <p class="mt-3 text-xs leading-relaxed text-dimmed">Off means the assistant is not offered it in your chats and tasks, and not in workflow AI steps for connected apps. Steps you built yourself in Workflow Studio still run.</p>

    <h3 class="mt-8 text-xs font-medium uppercase tracking-wider text-muted">Manage</h3>
    <ul class="mt-2 divide-y divide-default border-y border-default">
      <li v-for="m in MANAGE" :key="m.to">
        <RouterLink :to="m.to" class="flex items-center gap-3 py-3.5 outline-primary/25 transition-colors hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2">
          <UIcon :name="m.icon" class="size-4 text-muted" /><span class="flex-1 text-sm text-highlighted">{{ m.title }}</span><UIcon name="i-lucide-chevron-right" class="size-4 text-dimmed" />
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
