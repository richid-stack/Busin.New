<script setup lang="ts">
import StatusChip from '../tasks/StatusChip.vue'
import SettingRow from './SettingRow.vue'

defineEmits<{ go: [string] }>()

const ALWAYS = [
  { title: 'Sending, paying or deleting on a website', hint: 'The assistant stops, shows what it is about to do, and waits for your OK. It never types your passwords.' },
  { title: 'Running programs', hint: 'On your computer or in the cloud. You read the plan, and any file it writes, first.' },
  { title: 'Changing your connected apps', hint: 'Every write shows what will change before it happens.' },
  { title: 'Adding anything new', hint: 'Tool servers, skills and agents are only kept after you approve.' }
]
</script>

<template>
  <div>
    <h3 class="mt-6 text-xs font-medium uppercase tracking-wider text-muted">Always asks first</h3>
    <p class="mt-1 text-xs text-muted">These cannot be switched off.</p>
    <div class="mt-2 divide-y divide-default border-y border-default">
      <SettingRow v-for="r in ALWAYS" :key="r.title" :title="r.title" :hint="r.hint">
        <StatusChip label="Always" tone="quiet" />
      </SettingRow>
    </div>

    <h3 class="mt-8 text-xs font-medium uppercase tracking-wider text-muted">When you are away</h3>
    <div class="mt-2 divide-y divide-default border-y border-default">
      <SettingRow title="A task waiting for your OK" hint="It pauses and waits up to 30 minutes, then stops safely. Nothing happens without you.">
        <StatusChip label="30 min" tone="quiet" />
      </SettingRow>
      <button type="button" class="w-full text-left outline-primary/25 focus-visible:outline-2 focus-visible:-outline-offset-2" @click="$emit('go', 'notifications')">
        <SettingRow title="Tell me when it is waiting" hint="Alerts on your phone, and email.">
          <span class="flex items-center gap-1 text-sm text-muted">Notifications<UIcon name="i-lucide-chevron-right" class="size-4" /></span>
        </SettingRow>
      </button>
    </div>

    <h3 class="mt-8 text-xs font-medium uppercase tracking-wider text-muted">Keys and secrets</h3>
    <p class="mt-2 text-xs leading-relaxed text-muted">Never paste an API key into a chat. Add keys under Models or Connected apps; they are stored encrypted and never shown again.</p>
  </div>
</template>
