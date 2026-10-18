<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { $fetch } from 'ofetch'
import { useCsrf } from '../../../composables/useCsrf'
import { SCHEDULE_KINDS, WEEKDAYS, buildCron, defaultSchedule, parseCron } from '../../../utils/schedulePresets'
import type { ScheduleKind } from '../../../utils/schedulePresets'

const props = defineProps<{
  schedule?: { cron?: string, timezone?: string }
  /** Whether the workflow is switched on; schedules only run then. */
  active: boolean
  nextRunAt?: string | null
  error?: string | null
}>()
const emit = defineEmits<{ update: [schedule: { cron: string, timezone: string }] }>()

const { csrf, headerName } = useCsrf()
const csrfHeaders = (): Record<string, string> => {
  const token = csrf()
  return token ? { [headerName]: token } : {}
}

const fallback = defaultSchedule()
const cron = computed(() => props.schedule?.cron ?? fallback.cron)
const timezone = computed(() => props.schedule?.timezone || fallback.timezone)
const parts = computed(() => parseCron(cron.value))

// "Custom" stays selected while the user types, even if the text happens to match a preset.
const forcedCustom = ref(false)
const kind = computed<ScheduleKind>(() => (forcedCustom.value ? 'custom' : parts.value.kind))

const zones = computed(() => {
  let list: string[] = []
  try { list = (Intl as any).supportedValuesOf('timeZone') } catch { /* older browser */ }
  return Array.from(new Set(['UTC', timezone.value, ...list]))
})

function save(next: Partial<{ cron: string, timezone: string }>) {
  emit('update', { cron: cron.value, timezone: timezone.value, ...next })
}

function pickKind(value: ScheduleKind) {
  if (value === 'custom') {
    forcedCustom.value = true
    return
  }
  forcedCustom.value = false
  const current = parts.value
  save({ cron: buildCron({ ...current, kind: value, time: current.kind === 'custom' ? '09:00' : current.time }) })
}

function change(patch: Partial<{ time: string, weekday: number, monthDay: number }>) {
  save({ cron: buildCron({ ...parts.value, kind: kind.value === 'custom' ? 'daily' : kind.value, ...patch }) })
}

// Next runs, as worked out by the server so the form shows exactly what will happen.
const preview = ref<{ ok: boolean, runs?: string[], error?: string } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
watch([cron, timezone], () => {
  clearTimeout(timer)
  const mine = ++seq
  timer = setTimeout(async () => {
    try {
      const result = await $fetch<{ ok: boolean, runs?: string[], error?: string }>('/api/schedule/preview', {
        method: 'POST',
        headers: csrfHeaders(),
        body: { cron: cron.value, timezone: timezone.value }
      })
      if (mine === seq) preview.value = result
    } catch {
      if (mine === seq) preview.value = null
    }
  }, 350)
}, { immediate: true })

function format(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone.value }).format(new Date(iso))
  } catch {
    return iso
  }
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-octagon-alert"
      title="This schedule stopped"
      :description="error"
    />
    <UAlert
      v-else-if="!active"
      color="warning"
      variant="subtle"
      icon="i-lucide-rocket"
      title="Deploy to start the schedule"
      description="It only runs while this workflow is active. Use Deploy in the top bar."
    />

    <UFormField label="Run" size="sm">
      <USelect
        :model-value="kind"
        :items="SCHEDULE_KINDS"
        size="md"
        class="w-full"
        @update:model-value="pickKind($event as ScheduleKind)"
      />
    </UFormField>

    <UFormField v-if="kind === 'weekly'" label="On" size="sm">
      <USelect :model-value="parts.weekday" :items="WEEKDAYS" size="md" class="w-full" @update:model-value="change({ weekday: Number($event) })" />
    </UFormField>

    <UFormField v-if="kind === 'monthly'" label="Day of the month" size="sm" help="Days 1 to 28, so every month has a run.">
      <UInput :model-value="parts.monthDay" type="number" :min="1" :max="28" size="md" class="w-full" @update:model-value="change({ monthDay: Number($event) || 1 })" />
    </UFormField>

    <UFormField v-if="['daily', 'weekdays', 'weekly', 'monthly'].includes(kind)" label="At" size="sm">
      <UInput :model-value="parts.time" type="time" size="md" class="w-full" @update:model-value="change({ time: String($event) })" />
    </UFormField>

    <UFormField v-if="kind === 'hourly'" label="Minutes past the hour" size="sm">
      <UInput
        :model-value="Number(parts.time.split(':')[1])"
        type="number"
        :min="0"
        :max="59"
        size="md"
        class="w-full"
        @update:model-value="save({ cron: `${Math.min(59, Math.max(0, Number($event) || 0))} * * * *` })"
      />
    </UFormField>

    <UFormField v-if="kind === 'custom'" label="Cron expression" size="sm" help="Five parts: minute, hour, day of month, month, day of week.">
      <UInput
        :model-value="cron"
        size="md"
        class="w-full"
        :ui="{ base: 'font-mono' }"
        placeholder="0 9 * * 1-5"
        @update:model-value="save({ cron: String($event) })"
      />
    </UFormField>

    <UFormField label="Time zone" size="sm">
      <USelectMenu :model-value="timezone" :items="zones" size="md" class="w-full" @update:model-value="save({ timezone: String($event) })" />
    </UFormField>

    <div class="rounded-lg border border-default p-3 text-sm" aria-live="polite">
      <template v-if="preview?.ok && preview.runs?.length">
        <p class="font-medium mb-1.5">Next runs</p>
        <ul class="space-y-0.5 text-muted">
          <li v-for="run in preview.runs" :key="run">{{ format(run) }}</li>
        </ul>
      </template>
      <p v-else-if="preview && !preview.ok" class="text-error">{{ preview.error }}</p>
      <p v-else class="text-muted">Checking the schedule…</p>
    </div>

    <p v-if="active && nextRunAt && !error" class="text-xs text-muted">
      Queued for {{ format(nextRunAt) }}. The shortest gap allowed is 15 minutes.
    </p>
    <p v-else class="text-xs text-muted">The shortest gap allowed is 15 minutes, and each user can have 5 scheduled workflows on at once.</p>
  </div>
</template>
