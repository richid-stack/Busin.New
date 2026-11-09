<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskSchedules } from '../../composables/useTaskSchedules'
import { RESULT_DOT } from '../../types/taskSchedules'
import type { TaskScheduleItem } from '../../types/taskSchedules'
import { describeSchedule, formatMoment } from '../../utils/scheduleText'
import { timeAgo } from '../../utils/taskTime'

const router = useRouter()
const { schedules, setEnabled, runNow, removeSchedule } = useTaskSchedules()

const busy = ref<string | null>(null)
const confirming = ref<string | null>(null)
const error = ref<string | null>(null)

const message = (err: any, fallback: string) => err?.data?.statusMessage || err?.statusMessage || fallback

async function guard(id: string, fallback: string, fn: () => Promise<unknown>) {
  busy.value = id
  error.value = null
  try { await fn() } catch (err: any) { error.value = message(err, fallback) } finally { busy.value = null }
}

const run = (s: TaskScheduleItem) => guard(s.id, 'Could not start the task.', async () => {
  const task = await runNow(s.id)
  router.push(`/tasks/${task.id}`)
})
const toggle = (s: TaskScheduleItem) => guard(s.id, 'Could not change the schedule.', () => setEnabled(s.id, !s.enabled))
const remove = (s: TaskScheduleItem) => guard(s.id, 'Could not delete the schedule.', async () => { await removeSchedule(s.id); confirming.value = null })

const status = (s: TaskScheduleItem) => {
  if (s.error) return 'Paused'
  if (s.enabled && s.nextRunAt) return `Next run ${formatMoment(s.nextRunAt, s.timezone)}`
  return s.enabled ? '' : (s.runAt && s.lastRunAt ? 'Ran once' : 'Paused')
}
</script>

<template>
  <section v-if="schedules.length" class="mb-10" aria-labelledby="schedules-heading">
    <h2 id="schedules-heading" class="text-sm font-semibold text-highlighted mb-2">Schedules</h2>
    <ul class="divide-y divide-default rounded-2xl border border-default overflow-hidden">
      <li v-for="s in schedules" :key="s.id" class="flex items-start gap-3 px-4 py-3.5" :class="{ 'opacity-70': !s.enabled && !s.error }">
        <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="s.error ? 'bg-error' : RESULT_DOT[s.lastResult]" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-highlighted truncate">{{ s.title }}</p>
          <p class="text-xs text-muted mt-0.5 flex items-center gap-1.5 min-w-0">
            <UIcon :name="s.runAt ? 'i-lucide-calendar-clock' : 'i-lucide-repeat'" class="size-3.5 shrink-0" />
            <span class="truncate">{{ describeSchedule(s) }}<template v-if="status(s)"> · {{ status(s) }}</template></span>
          </p>
          <p v-if="s.note && !s.error" class="text-xs text-dimmed mt-0.5">
            {{ s.note }}
            <RouterLink v-if="s.lastTaskId" :to="`/tasks/${s.lastTaskId}`" class="underline underline-offset-2 hover:text-muted">See it</RouterLink>
            <span v-if="s.lastRunAt"> · {{ timeAgo(s.lastRunAt) }}</span>
          </p>
          <p v-if="s.error" class="text-xs text-error mt-0.5" role="alert">{{ s.error }}</p>
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
          <template v-if="confirming === s.id">
            <UButton label="Delete" size="xs" color="error" variant="subtle" :loading="busy === s.id" @click="remove(s)" />
            <UButton label="Keep" size="xs" color="neutral" variant="ghost" @click="confirming = null" />
          </template>
          <template v-else>
            <UTooltip text="Run now"><UButton icon="i-lucide-play" size="xs" color="neutral" variant="ghost" aria-label="Run now" :disabled="busy === s.id || s.awaiting" @click="run(s)" /></UTooltip>
            <UTooltip :text="s.enabled ? 'Pause' : 'Switch on'"><UButton :icon="s.enabled ? 'i-lucide-pause' : 'i-lucide-power'" size="xs" color="neutral" variant="ghost" :aria-label="s.enabled ? 'Pause schedule' : 'Switch schedule on'" :disabled="busy === s.id" @click="toggle(s)" /></UTooltip>
            <UTooltip text="Delete"><UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" aria-label="Delete schedule" @click="confirming = s.id" /></UTooltip>
          </template>
        </div>
      </li>
    </ul>
    <p v-if="error" class="text-xs text-error mt-2" role="alert">{{ error }}</p>
  </section>
</template>
