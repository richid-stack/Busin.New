<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTasks } from '../../composables/useTasks'
import { useAgents } from '../../composables/useAgents'
import { accentGradient } from '../../utils/accentGradient'
import type { TaskItem } from '../../types/tasks'

const props = defineProps<{ task: TaskItem }>()

const router = useRouter()
const { createTask } = useTasks()
const { agents, options, loaded, fetchAgents, fetchOptions, createAgent } = useAgents()

onMounted(() => {
  if (!loaded.value) fetchAgents()
  fetchOptions()
})

const error = ref<string | null>(null)

// ---- Run it again: the same goal and checks, fresh results ----
const running = ref(false)
async function runAgain() {
  if (running.value) return
  running.value = true
  error.value = null
  try {
    const next = await createTask({
      goal: props.task.goal,
      criteria: props.task.criteria.map(c => ({
        text: c.text,
        kind: c.kind,
        ...(c.format ? { format: c.format } : {}),
        ...(c.url ? { url: c.url } : {})
      })),
      ...(props.task.tools.length ? { tools: props.task.tools } : {})
    })
    router.push(`/tasks/${next.id}`)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || 'Could not start it again. Try again.'
  } finally {
    running.value = false
  }
}

// ---- Schedule: the new-task form opens with this task filled in ----
const schedule = () => router.push({ path: '/tasks', query: { from: props.task.id, schedule: '1' } })

// ---- Save as an agent ----
const open = ref(false)
const saving = ref(false)

/** A short name from the goal: the first few words, no full stop. */
function nameFrom(goal: string): string {
  const words = goal.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').split(' ')
  let out = ''
  for (const w of words) {
    if ((out + ' ' + w).trim().length > 40) break
    out = (out + ' ' + w).trim()
  }
  return (out || 'My agent').replace(/^./, c => c.toUpperCase())
}

/** What the agent will be told: the goal, then each check as something to make sure of. */
function instructionsFrom(task: TaskItem): string {
  const checks = task.criteria.map(c => c.text.trim().replace(/[.!?]+$/, '')).filter(Boolean)
  const goal = task.goal.trim()
  const text = checks.length ? `${goal}${/[.!?]$/.test(goal) ? '' : '.'} Check that ${checks.join('. Check that ')}.` : goal
  return text
}

const name = ref(nameFrom(props.task.goal))
const instructions = ref(instructionsFrom(props.task))

const groupLabel = (id: string) => options.value?.toolGroups.find(g => g.id === id)?.label ?? id
/** Only tools the agent list knows, and never the ones that act in your accounts. */
const toolIds = computed(() => {
  const known = options.value?.toolGroups ?? []
  const ids = props.task.tools.length ? props.task.tools : (options.value?.defaultGroups ?? [])
  return ids.filter(id => known.some(g => g.id === id && !g.sensitive))
})
const limit = computed(() => options.value?.limits.maxInstructions ?? 4000)
const canSave = computed(() => name.value.trim().length > 0 && instructions.value.trim().length > 0 && instructions.value.length <= limit.value && !saving.value && Boolean(options.value))

const saved = ref<{ id: string } | null>(null)
async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    const agent = await createAgent({
      name: name.value.trim(),
      description: '',
      instructions: instructions.value.trim(),
      model: null,
      tools: toolIds.value,
      skills: [],
      maxSteps: Math.min(Math.max(props.task.maxSteps, options.value!.limits.minSteps), options.value!.limits.maxSteps)
    })
    saved.value = { id: agent.id }
    open.value = false
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.statusMessage || 'Could not save the agent. Try again.'
  } finally {
    saving.value = false
  }
}
const alreadyKept = computed(() => saved.value ? agents.value.find(a => a.id === saved.value!.id) : undefined)
</script>

<template>
  <section aria-labelledby="use-again" class="mb-8">
    <div class="rounded-2xl border border-default bg-default divide-y divide-default overflow-hidden">
      <div class="px-4 py-3.5">
        <h2 id="use-again" class="text-sm font-semibold text-highlighted">
          Use this again
        </h2>
        <p class="text-xs text-muted leading-snug mt-0.5">
          This job worked. Keep it so you do not have to explain it twice.
        </p>
      </div>

      <div class="flex items-center justify-between gap-4 px-4 py-3.5">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">
            Run it again now
          </p>
          <p class="text-xs text-muted leading-snug">
            Same goal and checks, fresh results. Up to {{ task.maxAttempts }} {{ task.maxAttempts === 1 ? 'credit' : 'credits' }}.
          </p>
        </div>
        <UButton label="Run again" icon="i-lucide-rotate-cw" size="xs" color="neutral" variant="subtle" :loading="running" @click="runAgain" />
      </div>

      <div class="flex items-center justify-between gap-4 px-4 py-3.5">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">
            Repeat on a schedule
          </p>
          <p class="text-xs text-muted leading-snug">
            Every day, week or month. Opens the schedule box with this task filled in.
          </p>
        </div>
        <UButton label="Schedule" icon="i-lucide-calendar-clock" size="xs" color="neutral" variant="subtle" @click="schedule" />
      </div>

      <div class="flex items-center justify-between gap-4 px-4 py-3.5">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">
            Save as an agent
          </p>
          <p class="text-xs text-muted leading-snug">
            Keeps the instructions so you can use it in any chat.
          </p>
        </div>
        <div v-if="alreadyKept" class="flex items-center gap-2 shrink-0">
          <UButton :to="{ path: '/', query: { agent: alreadyKept.id } }" label="Chat with it" icon="i-lucide-message-circle" size="xs" color="neutral" variant="subtle" />
          <UButton to="/agents" label="Edit" icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" />
        </div>
        <UButton v-else-if="!open" label="Save as agent" icon="i-lucide-bot" size="xs" color="neutral" variant="subtle" @click="open = true" />
      </div>
    </div>

    <!-- The same card as every other decision: the soft colour behind it, the tile, plain words and two buttons. -->
    <div
      v-if="open"
      :class="['rise-in mt-3 rounded-3xl p-3 sm:p-4 min-w-0 max-w-full', accentGradient(name)]"
      role="group"
      aria-label="Save as an agent"
    >
      <div class="rounded-2xl border border-default bg-default/80 backdrop-blur shadow-sm p-4 sm:p-5 flex flex-col gap-4">
        <div class="flex items-start gap-3.5">
          <div class="size-11 rounded-xl bg-default border border-default shadow-sm flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-bot" class="size-6 text-primary" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-highlighted">
              Save this as an agent
            </p>
            <p class="text-xs text-muted mt-0.5">
              It shows up under Agents, and you can pick it in any chat. Nothing is saved until you press Save agent.
            </p>
          </div>
        </div>

        <UFormField label="Name" size="sm">
          <UInput v-model="name" class="w-full" :maxlength="60" />
        </UFormField>
        <UFormField label="What it will do" description="You can edit this." size="sm">
          <UTextarea v-model="instructions" class="w-full" :rows="4" autoresize :maxlength="limit" />
        </UFormField>

        <div v-if="toolIds.length" class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs text-muted mr-1">It can use</span>
          <UBadge v-for="id in toolIds" :key="id" :label="groupLabel(id)" color="neutral" variant="subtle" size="sm" />
        </div>

        <div class="flex items-center justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" :disabled="saving" @click="open = false" />
          <UButton label="Save agent" icon="i-lucide-check" color="neutral" :loading="saving" :disabled="!canSave" @click="save" />
        </div>
      </div>
    </div>

    <p v-if="error" class="text-xs text-error mt-2" role="alert">
      {{ error }}
    </p>
  </section>
</template>
