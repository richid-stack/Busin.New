import { ref, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { $fetch } from 'ofetch'
import type { NewTask, TaskEventItem, TaskItem } from '../types/tasks'
import { useCsrf } from './useCsrf'
import { useFirebaseAuth } from './useFirebaseAuth'

export const useTasks = createSharedComposable(() => {
  const tasks = ref<TaskItem[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const unauthorized = ref(false)
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

  async function fetchTasks() {
    const mine = ++generation
    loading.value = true
    loadError.value = null
    try {
      const list = await $fetch<TaskItem[]>('/api/tasks', { headers: headers() })
      if (mine !== generation) return
      tasks.value = Array.isArray(list) ? list : []
      unauthorized.value = false
    } catch (err: any) {
      if (mine !== generation) return
      const status = err?.statusCode ?? err?.status
      if (status === 401 || status === 403) { unauthorized.value = true; tasks.value = [] }
      else loadError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not load your tasks.'
    } finally {
      if (mine === generation) { loading.value = false; loaded.value = true }
    }
  }

  const upsert = (task: TaskItem) => {
    tasks.value = tasks.value.some(t => t.id === task.id) ? tasks.value.map(t => (t.id === task.id ? task : t)) : [task, ...tasks.value]
  }

  async function createTask(input: NewTask): Promise<TaskItem> {
    const task = await $fetch<TaskItem>('/api/tasks', { method: 'POST', headers: headers(), body: input })
    upsert(task)
    return task
  }

  async function getTask(id: string): Promise<{ task: TaskItem, events: TaskEventItem[] }> {
    const res = await $fetch<{ task: TaskItem, events: TaskEventItem[] }>(`/api/tasks/${encodeURIComponent(id)}`, { headers: headers() })
    upsert(res.task)
    return res
  }

  async function act(id: string, action: 'cancel' | 'accept'): Promise<TaskItem> {
    const task = await $fetch<TaskItem>(`/api/tasks/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: headers() })
    upsert(task)
    return task
  }

  /** Answers a task that paused for you: approve or decline the step, or say you dealt with what the page needed. */
  async function resumeTask(id: string, decision: 'approve' | 'decline' | 'continue'): Promise<TaskItem> {
    const task = await $fetch<TaskItem>(`/api/tasks/${encodeURIComponent(id)}/resume`, { method: 'POST', headers: headers(), body: { decision } })
    upsert(task)
    return task
  }

  async function removeTask(id: string) {
    await $fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() })
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  watch(() => firebaseUser.value?.uid ?? null, (uid, previous) => {
    if (uid === previous) return
    generation++
    tasks.value = []
    loaded.value = false
    loading.value = false
    loadError.value = null
    unauthorized.value = false
  })

  return { tasks, loading, loaded, unauthorized, loadError, fetchTasks, createTask, getTask, cancelTask: (id: string) => act(id, 'cancel'), acceptTask: (id: string) => act(id, 'accept'), resumeTask, removeTask }
})
