import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { NewTaskSchedule, TaskScheduleItem } from '../types/taskSchedules'
import type { TaskItem } from '../types/tasks'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

export const useTaskSchedules = createSharedComposable(() => {
  const schedules = ref<TaskScheduleItem[]>([])
  const loaded = ref(false)
  const loadError = ref<string | null>(null)
  const { csrf, headerName } = useCsrf()
  const { firebaseUser } = useFirebaseAuth()

  const headers = () => {
    const out: Record<string, string> = {}
    const token = csrf()
    if (token) out[headerName] = token
    return out
  }

  let generation = 0

  async function fetchSchedules() {
    const mine = ++generation
    loadError.value = null
    try {
      const list = await $fetch<TaskScheduleItem[]>('/api/task-schedules', { headers: headers() })
      if (mine !== generation) return
      schedules.value = Array.isArray(list) ? list : []
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) schedules.value = []
      else loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your schedules.'
    } finally {
      if (mine === generation) loaded.value = true
    }
  }

  const upsert = (s: TaskScheduleItem) => {
    schedules.value = schedules.value.some(x => x.id === s.id) ? schedules.value.map(x => (x.id === s.id ? s : x)) : [s, ...schedules.value]
  }

  async function createSchedule(input: NewTaskSchedule): Promise<TaskScheduleItem> {
    const s = await $fetch<TaskScheduleItem>('/api/task-schedules', { method: 'POST', headers: headers(), body: input })
    upsert(s)
    return s
  }

  async function setEnabled(id: string, enabled: boolean): Promise<TaskScheduleItem> {
    const s = await $fetch<TaskScheduleItem>(`/api/task-schedules/${encodeURIComponent(id)}/${enabled ? 'resume' : 'pause'}`, { method: 'POST', headers: headers() })
    upsert(s)
    return s
  }

  /** Starts the saved task now. Returns the new task; the schedule changes too, so it is refreshed. */
  async function runNow(id: string): Promise<TaskItem> {
    const task = await $fetch<TaskItem>(`/api/task-schedules/${encodeURIComponent(id)}/run`, { method: 'POST', headers: headers() })
    await fetchSchedules()
    return task
  }

  async function removeSchedule(id: string) {
    await $fetch(`/api/task-schedules/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() })
    schedules.value = schedules.value.filter(s => s.id !== id)
  }

  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    schedules.value = []
    loaded.value = false
    loadError.value = null
  })

  return { schedules, loaded, loadError, fetchSchedules, createSchedule, setEnabled, runNow, removeSchedule }
})
