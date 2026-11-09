<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isToolStreaming } from '@nuxt/ui/utils/ai'
import { useTasks } from '../../../composables/useTasks'
import { useFirebaseAuth } from '../../../composables/useFirebaseAuth'
import type { NewTask, CriterionKind } from '../../../types/tasks'

const props = defineProps<{ invocation: any }>()
const { tasks, loaded, fetchTasks, createTask } = useTasks()
const { openAuthModal, isAuthenticated } = useFirebaseAuth()

const streaming = computed(() => isToolStreaming(props.invocation))
const output = computed(() => props.invocation.output)
const draft = computed<NewTask | null>(() => (output.value?.status === 'proposed' ? output.value.draft : null))

onMounted(() => { if (!loaded.value) fetchTasks() })

// A reload forgets the click, so "already started" is judged by what the person's tasks really contain.
const startedTask = computed(() => (draft.value ? tasks.value.find(t => t.goal === draft.value!.goal) : undefined))
const startedHere = ref<string | null>(null)
const taskId = computed(() => startedHere.value ?? startedTask.value?.id ?? null)

const starting = ref(false)
const error = ref<string | null>(null)

const KIND: Record<CriterionKind, string> = { file: 'A file is made', visual: 'A page looks right', check: 'Checked by AI', manual: 'You check it' }

async function start() {
  if (!draft.value || starting.value) return
  if (!isAuthenticated.value) return openAuthModal()
  starting.value = true
  error.value = null
  try {
    startedHere.value = (await createTask(draft.value)).id
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || 'Could not start the task. Try again.'
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <UChatTool
    v-if="streaming || !draft"
    :text="streaming ? 'Drafting a task...' : 'Could not draft the task'"
    :streaming="streaming"
    icon="i-lucide-list-checks"
    chevron="leading"
  >
    <p
      v-if="!streaming && output?.error"
      class="text-sm text-muted"
    >
      {{ output.error }}
    </p>
  </UChatTool>

  <div
    v-else
    class="my-2 max-w-xl rounded-xl border border-default px-4 py-3"
  >
    <p class="flex items-center gap-1.5 text-xs font-medium text-muted">
      <UIcon
        name="i-lucide-list-checks"
        class="size-4"
      />
      Task
    </p>
    <p class="mt-1 text-sm font-medium text-highlighted">
      {{ draft.goal }}
    </p>
    <p
      v-if="draft.tools?.includes('browser')"
      class="mt-1.5 text-xs text-muted"
    >
      Uses a browser. It stops and asks you before it sends, buys or deletes anything, and when a page needs you to sign in.
    </p>
    <ul
      v-if="draft.criteria.length"
      class="mt-2 space-y-1"
    >
      <li
        v-for="(c, i) in draft.criteria"
        :key="i"
        class="text-xs text-muted"
      >
        <span class="text-default">{{ c.text }}</span> · {{ KIND[c.kind] }}
      </li>
    </ul>

    <div class="mt-3 flex items-center justify-between gap-3">
      <p
        v-if="taskId"
        class="text-xs text-muted"
      >
        Started. It keeps working if you leave.
      </p>
      <p
        v-else
        class="text-xs text-muted"
      >
        Uses credits as it works.
      </p>
      <RouterLink
        v-if="taskId"
        :to="`/tasks/${taskId}`"
      >
        <UButton
          label="View task"
          icon="i-lucide-arrow-right"
          trailing
          size="xs"
          color="neutral"
          variant="subtle"
        />
      </RouterLink>
      <UButton
        v-else
        label="Start task"
        icon="i-lucide-play"
        size="xs"
        color="neutral"
        :loading="starting"
        @click="start"
      />
    </div>
    <p
      v-if="error"
      class="mt-2 text-xs text-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>
