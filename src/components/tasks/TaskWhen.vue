<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { $fetch } from 'ofetch'
import { useCsrf } from '../../composables/useCsrf'
import { SCHEDULE_KINDS, WEEKDAYS } from '../../utils/schedulePresets'
import type { ScheduleKind } from '../../utils/schedulePresets'
import { formatMoment } from '../../utils/scheduleText'
import { whenPayload } from '../../utils/taskWhen'
import type { WhenState } from '../../utils/taskWhen'

const state = defineModel<WhenState>({ required: true })

// Tasks cost AI credits on every run, so "every 15 minutes" is not offered.
const KINDS = SCHEDULE_KINDS.filter(k => k.value !== 'every-15')

const { csrf, headerName } = useCsrf()
const set = (patch: Partial<WhenState>) => { state.value = { ...state.value, ...patch } }

const zones = computed(() => {
  let list: string[] = []
  try { list = (Intl as any).supportedValuesOf('timeZone') } catch { /* older browser */ }
  return Array.from(new Set(['UTC', state.value.timezone, ...list]))
})

const preview = ref<{ ok: boolean, runs?: string[], error?: string } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
watch(() => [state.value.mode, JSON.stringify(whenPayload(state.value))], () => {
  clearTimeout(timer)
  if (state.value.mode === 'once') { preview.value = null; return }
  const mine = ++seq
  const p = whenPayload(state.value) as { cron: string, timezone: string }
  timer = setTimeout(async () => {
    try {
      const token = csrf()
      const result = await $fetch<{ ok: boolean, runs?: string[], error?: string }>('/api/schedule/preview', {
        method: 'POST', headers: token ? { [headerName]: token } : {}, body: { cron: p.cron, timezone: p.timezone, for: 'task' }
      })
      if (mine === seq) preview.value = result
    } catch {
      if (mine === seq) preview.value = null
    }
  }, 350)
}, { immediate: true })

const onceNote = computed(() => {
  if (!state.value.at) return ''
  const d = new Date(state.value.at)
  return Number.isFinite(d.getTime()) ? formatMoment(d.toISOString(), state.value.timezone) : ''
})
</script>

<template>
  <div class="space-y-3">
    <div class="inline-flex rounded-lg border border-default p-0.5 bg-elevated/50" role="group" aria-label="How often">
      <UButton label="Repeat" icon="i-lucide-repeat" size="xs" color="neutral" :variant="state.mode === 'repeat' ? 'solid' : 'ghost'" @click="set({ mode: 'repeat' })" />
      <UButton label="Once, later" icon="i-lucide-calendar-clock" size="xs" color="neutral" :variant="state.mode === 'once' ? 'solid' : 'ghost'" @click="set({ mode: 'once' })" />
    </div>

    <div v-if="state.mode === 'repeat'" class="grid gap-3 sm:grid-cols-2">
      <UFormField label="Run" size="sm">
        <USelect :model-value="state.kind" :items="KINDS" class="w-full" @update:model-value="set({ kind: $event as ScheduleKind })" />
      </UFormField>
      <UFormField v-if="state.kind === 'weekly'" label="On" size="sm">
        <USelect :model-value="state.weekday" :items="WEEKDAYS" class="w-full" @update:model-value="set({ weekday: Number($event) })" />
      </UFormField>
      <UFormField v-if="state.kind === 'monthly'" label="Day of the month" size="sm" help="Days 1 to 28.">
        <UInput :model-value="state.monthDay" type="number" :min="1" :max="28" class="w-full" @update:model-value="set({ monthDay: Number($event) || 1 })" />
      </UFormField>
      <UFormField v-if="['daily', 'weekdays', 'weekly', 'monthly'].includes(state.kind)" label="At" size="sm">
        <UInput :model-value="state.time" type="time" class="w-full" @update:model-value="set({ time: String($event) })" />
      </UFormField>
      <UFormField v-if="state.kind === 'hourly'" label="Minutes past the hour" size="sm">
        <UInput :model-value="Number(state.time.split(':')[1])" type="number" :min="0" :max="59" class="w-full" @update:model-value="set({ time: `00:${String(Math.min(59, Math.max(0, Number($event) || 0))).padStart(2, '0')}` })" />
      </UFormField>
      <UFormField v-if="state.kind === 'custom'" label="Cron expression" size="sm" help="minute hour day month weekday" class="sm:col-span-2">
        <UInput :model-value="state.custom" class="w-full" :ui="{ base: 'font-mono' }" placeholder="0 9 * * 1-5" @update:model-value="set({ custom: String($event) })" />
      </UFormField>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <UFormField label="Run it at" size="sm">
        <UInput :model-value="state.at" type="datetime-local" class="w-full" @update:model-value="set({ at: String($event) })" />
      </UFormField>
    </div>

    <UFormField label="Time zone" size="sm">
      <USelectMenu :model-value="state.timezone" :items="zones" class="w-full sm:w-72" @update:model-value="set({ timezone: String($event) })" />
    </UFormField>

    <div class="text-xs" aria-live="polite">
      <template v-if="state.mode === 'once'">
        <p v-if="onceNote" class="text-muted">Runs once on {{ onceNote }}, then switches itself off.</p>
      </template>
      <template v-else-if="preview?.ok && preview.runs?.length">
        <p class="text-muted">Next: {{ preview.runs.slice(0, 3).map(r => formatMoment(r, state.timezone)).join(' · ') }}</p>
      </template>
      <p v-else-if="preview && !preview.ok" class="text-error">{{ preview.error }}</p>
    </div>
  </div>
</template>
