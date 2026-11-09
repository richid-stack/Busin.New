<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTasks } from '../../composables/useTasks'
import { useFirebaseAuth } from '../../composables/useFirebaseAuth'
import { useUserSession } from '../../composables/useUserSession'
import { TASK_STATUS } from '../../types/tasks'
import type { CriterionKind } from '../../types/tasks'
import { timeAgo } from '../../utils/taskTime'

const router = useRouter()
const { openAuthModal } = useFirebaseAuth()
const { loggedIn } = useUserSession()
const { tasks, loading, loaded, unauthorized, loadError, fetchTasks, createTask } = useTasks()

onMounted(fetchTasks)
watch(loggedIn, fetchTasks)

// While anything is running, keep the list fresh.
let timer: ReturnType<typeof setInterval> | undefined
const anyWorking = computed(() => tasks.value.some(t => TASK_STATUS[t.status].working))
watch(anyWorking, (on) => {
  clearInterval(timer)
  if (on) timer = setInterval(fetchTasks, 4000)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(timer))

// ---- New task ----
const KINDS: Array<{ label: string, value: CriterionKind }> = [
  { label: 'Checked by AI', value: 'check' },
  { label: 'A file exists', value: 'file' },
  { label: 'A page looks right', value: 'visual' },
  { label: 'I will check it', value: 'manual' }
]
const FORMATS = [{ label: 'Any file', value: 'any' }, { label: 'Word', value: 'docx' }, { label: 'PDF', value: 'pdf' }, { label: 'Excel', value: 'xlsx' }, { label: 'PowerPoint', value: 'pptx' }]

const goal = ref('')
const criteria = ref<Array<{ text: string, kind: CriterionKind, format: string, url: string }>>([])
const creating = ref(false)
const createError = ref<string | null>(null)

const addCriterion = () => { if (criteria.value.length < 8) criteria.value.push({ text: '', kind: 'check', format: 'any', url: '' }) }
const removeCriterion = (i: number) => criteria.value.splice(i, 1)
const canStart = computed(() => goal.value.trim().length >= 10 && !creating.value)

async function start() {
  if (!canStart.value) return
  creating.value = true
  createError.value = null
  try {
    const task = await createTask({
      goal: goal.value.trim(),
      criteria: criteria.value.filter(c => c.text.trim()).map(c => ({
        text: c.text.trim(),
        kind: c.kind,
        ...(c.kind === 'file' && c.format !== 'any' ? { format: c.format } : {}),
        ...(c.kind === 'visual' ? { url: c.url.trim() } : {})
      }))
    })
    goal.value = ''
    criteria.value = []
    router.push(`/tasks/${task.id}`)
  } catch (err: any) {
    createError.value = err?.data?.statusMessage || err?.statusMessage || 'Could not start the task. Try again.'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 md:py-20 flex-1">
      <div class="mb-8">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight text-highlighted mb-3">Tasks</h1>
        <p class="text-muted text-base md:text-lg">Give OpenLobs a goal and how you will know it worked. It does the work on its own, checks the result, and tells you honestly how it went.</p>
      </div>

      <div v-if="unauthorized" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
        <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
          <UIcon name="i-lucide-lock" class="size-5 text-muted" />
        </div>
        <h2 class="text-base font-semibold text-highlighted mb-1">Sign in to run tasks</h2>
        <p class="text-sm text-muted mb-5">Tasks use your account, so only you can see them.</p>
        <UButton label="Sign in" icon="i-lucide-log-in" color="neutral" @click="openAuthModal" />
      </div>

      <template v-else>
        <form class="rounded-2xl border border-default bg-default p-4 sm:p-5 mb-10 space-y-4" @submit.prevent="start">
          <UFormField label="What should it get done?" size="sm">
            <UTextarea
              v-model="goal"
              :rows="3"
              :maxlength="2000"
              autoresize
              class="w-full"
              placeholder="Find three scholarships I could apply to this year and make a Word summary with deadlines."
            />
          </UFormField>

          <div>
            <p class="text-sm font-medium text-highlighted">How will you know it worked?</p>
            <p class="text-xs text-muted mb-2">Optional. Without any, one AI check asks whether the result does what you asked.</p>
            <ul v-if="criteria.length" class="space-y-2 mb-2">
              <li v-for="(c, i) in criteria" :key="i" class="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <UInput v-model="c.text" class="flex-1 min-w-[12rem]" size="sm" :maxlength="300" placeholder="e.g. Each scholarship has a deadline" :aria-label="`Criterion ${i + 1}`" />
                <USelect v-model="c.kind" :items="KINDS" size="sm" class="w-44" :aria-label="`How criterion ${i + 1} is checked`" />
                <USelect v-if="c.kind === 'file'" v-model="c.format" :items="FORMATS" size="sm" class="w-32" aria-label="File type" />
                <UInput v-if="c.kind === 'visual'" v-model="c.url" size="sm" class="w-56" placeholder="https://example.com" aria-label="Page address" />
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="`Remove criterion ${i + 1}`" @click="removeCriterion(i)" />
              </li>
            </ul>
            <UButton v-if="criteria.length < 8" label="Add a check" icon="i-lucide-plus" size="xs" color="neutral" variant="subtle" @click="addCriterion" />
          </div>

          <div class="flex items-center justify-between gap-3 pt-1">
            <p class="text-xs text-dimmed">Uses credits like chat messages: once per attempt, up to 2 attempts.</p>
            <UButton type="submit" label="Start task" icon="i-lucide-play" color="neutral" :loading="creating" :disabled="!canStart" />
          </div>
          <p v-if="createError" class="text-xs text-error" role="alert">{{ createError }}</p>
        </form>

        <div v-if="loadError" class="rounded-2xl border border-default bg-elevated/50 p-8 text-center">
          <h2 class="text-base font-semibold text-highlighted mb-1">Could not load your tasks</h2>
          <p class="text-sm text-muted mb-5">{{ loadError }}</p>
          <UButton label="Try again" icon="i-lucide-refresh-cw" color="neutral" variant="subtle" :loading="loading" @click="fetchTasks" />
        </div>

        <div v-else-if="!loaded" class="py-12 flex justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
        </div>

        <div v-else-if="!tasks.length" class="rounded-2xl border border-dashed border-default p-10 text-center">
          <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
            <UIcon name="i-lucide-list-checks" class="size-5 text-muted" />
          </div>
          <h2 class="text-base font-semibold text-highlighted mb-1">No tasks yet</h2>
          <p class="text-sm text-muted">Describe a goal above. You can close this page: it keeps working.</p>
        </div>

        <ul v-else class="divide-y divide-default rounded-2xl border border-default overflow-hidden">
          <li v-for="t in tasks" :key="t.id">
            <RouterLink :to="`/tasks/${t.id}`" class="flex items-start gap-3 px-4 py-3.5 hover:bg-elevated/60 transition-colors">
              <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="TASK_STATUS[t.status].dot" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted truncate">{{ t.goal }}</p>
                <p class="text-xs text-muted mt-0.5 truncate">{{ t.outcome || TASK_STATUS[t.status].label }}</p>
              </div>
              <span class="text-xs text-dimmed shrink-0 mt-0.5">{{ timeAgo(t.createdAt) }}</span>
            </RouterLink>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
