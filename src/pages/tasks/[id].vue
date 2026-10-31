<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasks } from '../../composables/useTasks'
import { TASK_STATUS } from '../../types/tasks'
import type { CriterionStatus, TaskArtifact, TaskEventItem, TaskItem } from '../../types/tasks'
import { duration, timeAgo } from '../../utils/taskTime'
import ChatToolApproval from '../../components/chat/tool/Approval.vue'
import ChatToolBrowserView from '../../components/chat/tool/BrowserView.vue'

const route = useRoute()
const router = useRouter()
const { getTask, cancelTask, acceptTask, removeTask, resumeTask } = useTasks()

const id = computed(() => String((route.params as any).id))
const task = ref<TaskItem | null>(null)
const events = ref<TaskEventItem[]>([])
const missing = ref(false)
const loadError = ref<string | null>(null)
const busy = ref<'cancel' | 'accept' | 'delete' | 'resume' | null>(null)
const actionError = ref<string | null>(null)
const showLog = ref(false)

const status = computed(() => (task.value ? TASK_STATUS[task.value.status] : null))
const working = computed(() => Boolean(status.value?.working))
/** Paused for you: the browser page is open and waiting for an answer. */
const waiting = computed(() => task.value?.status === 'needs_you' ? task.value.waiting ?? null : null)
/** The live page is shown while a task that uses the browser is working or waiting. */
const showBrowser = computed(() => Boolean(task.value?.tools.includes('browser') && (working.value || waiting.value)))
const waitSite = computed(() => (waiting.value?.label.match(/ on ([^\s]+)$/)?.[1]) ?? '')
const minutesLeft = computed(() => (waiting.value ? Math.max(1, Math.round((new Date(waiting.value.until).getTime() - Date.now()) / 60_000)) : 0))

// The approval card asks through this, the same way it does in a chat; here the answer goes to the task.
async function answerWaiting(_id: string, approved: boolean) {
  if (!waiting.value) return
  busy.value = 'resume'
  actionError.value = null
  try {
    task.value = await resumeTask(id.value, waiting.value.reason === 'person' ? 'continue' : approved ? 'approve' : 'decline')
    await load()
  } catch (err: any) {
    actionError.value = err?.data?.statusMessage || err?.statusMessage || 'That did not work. Try again.'
  } finally {
    busy.value = null
  }
}
provide('respondToToolApproval', answerWaiting)

async function load() {
  try {
    const res = await getTask(id.value)
    task.value = res.task
    events.value = res.events
    loadError.value = null
  } catch (err: any) {
    if ((err?.statusCode ?? err?.status) === 404) missing.value = true
    else if (!task.value) loadError.value = err?.data?.statusMessage || 'Could not load this task.'
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  await load()
  timer = setInterval(() => { if (working.value || waiting.value || !task.value) load() }, 3000)
})
onBeforeUnmount(() => clearInterval(timer))

async function run(kind: 'cancel' | 'accept' | 'delete') {
  busy.value = kind
  actionError.value = null
  try {
    if (kind === 'delete') {
      await removeTask(id.value)
      router.push('/tasks')
      return
    }
    task.value = await (kind === 'cancel' ? cancelTask(id.value) : acceptTask(id.value))
    await load()
  } catch (err: any) {
    actionError.value = err?.data?.statusMessage || err?.statusMessage || 'That did not work. Try again.'
  } finally {
    busy.value = null
  }
}

const CRITERION: Record<CriterionStatus, { icon: string, tone: string, label: string }> = {
  met: { icon: 'i-lucide-circle-check', tone: 'text-success', label: 'Met' },
  unmet: { icon: 'i-lucide-circle-x', tone: 'text-error', label: 'Not met' },
  unsure: { icon: 'i-lucide-circle-help', tone: 'text-warning', label: 'Could not tell' },
  pending: { icon: 'i-lucide-hand', tone: 'text-warning', label: 'Waiting for you' },
  unchecked: { icon: 'i-lucide-circle-dashed', tone: 'text-dimmed', label: 'Not checked yet' }
}

const downloading = ref<string | null>(null)
const downloadError = ref<string | null>(null)
async function download(a: TaskArtifact) {
  if (downloading.value) return
  downloading.value = a.fileId
  downloadError.value = null
  let url = ''
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(a.fileId)}`)
    if (!res.ok) { downloadError.value = res.status === 404 ? 'That file has expired or is no longer available.' : 'The download failed. Try again.'; return }
    url = URL.createObjectURL(await res.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = a.name
    document.body.appendChild(link)
    link.click()
    link.remove()
  } catch {
    downloadError.value = 'The download failed. Check your connection and try again.'
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000)
    downloading.value = null
  }
}

const took = computed(() => (task.value && !working.value ? duration(task.value.startedAt, task.value.finishedAt) : ''))
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
</script>

<template>
  <div class="flex-1 min-w-0 h-full flex flex-col bg-default overflow-y-auto">
    <div class="max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 md:py-16 flex-1">
      <RouterLink
        to="/tasks"
        class="inline-flex items-center gap-1 text-sm text-muted hover:text-default mb-6"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        /> Tasks
      </RouterLink>

      <div
        v-if="missing"
        class="rounded-2xl border border-default bg-elevated/50 p-8 text-center"
      >
        <h2 class="text-base font-semibold text-highlighted mb-1">
          Task not found
        </h2>
        <p class="text-sm text-muted">
          It may have been deleted.
        </p>
      </div>
      <div
        v-else-if="loadError"
        class="rounded-2xl border border-default bg-elevated/50 p-8 text-center"
      >
        <h2 class="text-base font-semibold text-highlighted mb-1">
          Could not load this task
        </h2>
        <p class="text-sm text-muted mb-5">
          {{ loadError }}
        </p>
        <UButton
          label="Try again"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="subtle"
          @click="load"
        />
      </div>
      <div
        v-else-if="!task"
        class="py-12 flex justify-center"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="size-6 animate-spin text-muted"
        />
      </div>

      <template v-else>
        <div class="flex items-center gap-2 text-sm mb-3">
          <span
            class="size-2 rounded-full"
            :class="status!.dot"
            aria-hidden="true"
          />
          <span class="font-medium text-highlighted">{{ status!.label }}</span>
          <span
            v-if="working"
            class="text-muted"
          >· attempt {{ Math.max(task.attempts, 1) }} of {{ task.maxAttempts }}</span>
          <span
            v-else-if="took"
            class="text-muted"
          >· took {{ took }}</span>
        </div>
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight text-highlighted mb-3 break-words">
          {{ task.goal }}
        </h1>
        <p
          v-if="task.outcome"
          class="text-base text-default mb-8"
        >
          {{ task.outcome }}
        </p>
        <p
          v-else-if="waiting"
          class="text-base text-default mb-8"
        >
          Paused: it needs you. {{ waiting.label }}.
        </p>
        <p
          v-else
          class="text-base text-muted mb-8"
        >
          Working on it. You can leave this page: the task keeps running.
        </p>

        <!-- A task that uses the browser: watch the page, and answer it when it needs you. The same cards as in a chat. -->
        <section
          v-if="showBrowser"
          class="mb-8"
        >
          <ChatToolBrowserView
            :chat-id="`task-${task.id}`"
            :live="true"
            :working="working"
          />
          <ChatToolApproval
            v-if="waiting"
            :key="waiting.since"
            :part="{ type: 'tool-browser', input: {}, approval: { id: task.id } }"
            :instruction="waiting.label"
            :label="waitSite"
            :person="waiting.reason === 'person'"
          />
          <p
            v-if="waiting"
            class="text-xs text-muted px-1"
          >
            The page stays open for about {{ minutesLeft }} more {{ minutesLeft === 1 ? 'minute' : 'minutes' }}. If you do not come back, the task stops.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="text-sm font-semibold text-highlighted mb-3">
            Checks
          </h2>
          <ul class="divide-y divide-default">
            <li
              v-for="c in task.criteria"
              :key="c.id"
              class="flex gap-3 py-3 first:pt-0"
            >
              <UIcon
                :name="CRITERION[c.status].icon"
                class="size-5 shrink-0 mt-0.5"
                :class="CRITERION[c.status].tone"
              />
              <div class="min-w-0 text-sm">
                <p class="text-highlighted">
                  {{ c.text }}
                </p>
                <p class="text-xs text-muted mt-0.5">
                  {{ CRITERION[c.status].label }}<template v-if="c.evidence">
                    · {{ c.evidence }}
                  </template>
                </p>
                <p
                  v-if="c.status === 'unmet' && c.fix"
                  class="text-xs text-muted mt-0.5"
                >
                  <span class="font-medium text-default">To fix:</span> {{ c.fix }}
                </p>
              </div>
            </li>
          </ul>
        </section>

        <section
          v-if="task.artifacts.length"
          class="mb-8"
        >
          <h2 class="text-sm font-semibold text-highlighted mb-3">
            Files
          </h2>
          <ul class="divide-y divide-default">
            <li
              v-for="a in task.artifacts"
              :key="a.fileId"
              class="flex items-center justify-between gap-3 py-2.5 first:pt-0"
            >
              <p class="text-sm text-highlighted truncate">
                {{ a.name }}<span
                  v-if="a.sizeKb"
                  class="text-xs text-muted"
                > · {{ a.sizeKb }} KB</span>
              </p>
              <UButton
                icon="i-lucide-download"
                label="Download"
                size="xs"
                color="neutral"
                variant="subtle"
                :loading="downloading === a.fileId"
                @click="download(a)"
              />
            </li>
          </ul>
          <p
            v-if="downloadError"
            class="text-xs text-error mt-2"
            role="alert"
          >
            {{ downloadError }}
          </p>
        </section>

        <section
          v-if="task.result"
          class="mb-8"
        >
          <h2 class="text-sm font-semibold text-highlighted mb-1">
            What the agent says it did
          </h2>
          <p class="text-xs text-muted mb-2">
            Its own account. The checks above are what count.
          </p>
          <p class="text-sm text-default whitespace-pre-wrap break-words">
            {{ task.result }}
          </p>
        </section>

        <div class="flex flex-wrap items-center gap-2 mb-8">
          <UButton
            v-if="task.status === 'needs_review'"
            label="Looks good, mark as done"
            icon="i-lucide-check"
            color="neutral"
            :loading="busy === 'accept'"
            @click="run('accept')"
          />
          <UButton
            v-if="working || waiting"
            label="Stop"
            icon="i-lucide-square"
            color="neutral"
            variant="subtle"
            :loading="busy === 'cancel'"
            @click="run('cancel')"
          />
          <UButton
            v-if="task.status === 'needs_review'"
            label="Discard"
            color="neutral"
            variant="ghost"
            :loading="busy === 'cancel'"
            @click="run('cancel')"
          />
          <UButton
            v-if="!working && !waiting && task.status !== 'needs_review'"
            label="Delete"
            icon="i-lucide-trash"
            color="error"
            variant="ghost"
            :loading="busy === 'delete'"
            @click="run('delete')"
          />
        </div>
        <p
          v-if="actionError"
          class="text-xs text-error -mt-6 mb-8"
          role="alert"
        >
          {{ actionError }}
        </p>

        <section>
          <button
            type="button"
            class="flex items-center gap-1.5 text-sm font-semibold text-highlighted"
            :aria-expanded="showLog"
            @click="showLog = !showLog"
          >
            Activity <span class="font-normal text-muted">({{ events.length }})</span>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-4 text-muted transition-transform"
              :class="showLog ? 'rotate-180' : ''"
            />
          </button>
          <ol
            v-if="showLog"
            class="mt-3 space-y-1.5 border-l border-default pl-4"
          >
            <li
              v-for="e in events"
              :key="e.id"
              class="text-xs"
            >
              <span class="text-dimmed tabular-nums">{{ time(e.at) }}</span>
              <span
                class="ml-2"
                :class="e.kind === 'error' ? 'text-error' : 'text-muted'"
              >{{ e.text }}</span>
            </li>
          </ol>
          <p class="text-[11px] text-dimmed mt-4">
            Started {{ timeAgo(task.createdAt) }}. Checked by file lookups, screenshots and AI judgement; AI judgement is labelled as such.
          </p>
        </section>
      </template>
    </div>
  </div>
</template>
